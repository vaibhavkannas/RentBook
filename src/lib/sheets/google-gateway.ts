import { auth as googleAuth, sheets as createSheets, type sheets_v4 } from "@googleapis/sheets";
import { configError, tabMissing } from "@/lib/errors";
import type { CellWrite, RowOverride, SheetsGateway, ValueRender } from "./gateway";
import { missingTabOf, translateGoogleError } from "./google-errors";
import { resetBootstrap } from "./settings-store";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

type SheetProps = { sheetId: number; title: string; rowCount: number };

function extendedValue(value: string | number): sheets_v4.Schema$ExtendedValue {
  return typeof value === "number" ? { numberValue: value } : { stringValue: value };
}

export class GoogleSheetsGateway implements SheetsGateway {
  constructor(
    private readonly api: sheets_v4.Sheets,
    private readonly spreadsheetId: string,
    private readonly serviceAccountEmail?: string,
  ) {}

  static fromServiceAccount(serviceAccountJson: string, spreadsheetId: string) {
    let credentials: { client_email?: string; private_key?: string } | null;
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch {
      // The parse error is dropped on purpose: its text can quote part of the key.
      throw configError(
        "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the key file as one line, without surrounding quotes.",
      );
    }
    if (
      !credentials ||
      typeof credentials !== "object" ||
      typeof credentials.client_email !== "string" ||
      typeof credentials.private_key !== "string"
    ) {
      throw configError(
        "GOOGLE_SERVICE_ACCOUNT_JSON must be the service account key file, with client_email and private_key.",
      );
    }
    const authClient = new googleAuth.GoogleAuth({ credentials, scopes: [SCOPE] });
    return new GoogleSheetsGateway(
      createSheets({ version: "v4", auth: authClient }),
      spreadsheetId,
      credentials.client_email,
    );
  }

  /**
   * Makes one Google call. `tabs` are the tabs the request names: a failure that says one of them does not
   * exist becomes "tab not found", and the app's tab check is run again on the next request, so a tab deleted
   * or renamed while the app runs is noticed (and a deleted Payments Log or Tenants tab put back).
   */
  private async call<T>(run: () => Promise<T>, tabs: string[] = []): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw this.translate(error, tabs);
    }
  }

  private translate(error: unknown, tabs: string[]): unknown {
    const tab = missingTabOf(error, tabs);
    if (tab !== null) resetBootstrap(this);
    return translateGoogleError(error, this.serviceAccountEmail, tab ?? undefined);
  }

  private async sheetProps(): Promise<SheetProps[]> {
    const { data } = await this.call(() =>
      this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties(sheetId,title,gridProperties.rowCount)",
      }),
    );
    return (data.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? "",
      rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
    }));
  }

  async listTabs() {
    return (await this.sheetProps()).map((sheet) => sheet.title);
  }

  async addTab(title: string) {
    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      }),
    );
  }

  async getValues(tab: string, a1: string, render: ValueRender) {
    try {
      const { data } = await this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${quote(tab)}!${a1}`,
        valueRenderOption: render,
        dateTimeRenderOption: "SERIAL_NUMBER",
      });
      return (data.values ?? []) as unknown[][];
    } catch (error) {
      // Google rejects a range that starts below the last row of the grid. Nothing
      // is stored there, so it reads as empty (the "row under the table" check
      // relies on this when the table fills the whole grid).
      const message = error instanceof Error ? error.message : "";
      if (/exceeds grid limits/i.test(message)) return [];
      throw this.translate(error, [tab]);
    }
  }

  async updateValues(writes: CellWrite[]) {
    if (writes.length === 0) return;
    await this.call(
      () =>
        this.api.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            valueInputOption: "RAW",
            data: writes.map((write) => ({
              range: `${quote(write.tab)}!${write.a1}`,
              values: write.values,
            })),
          },
        }),
      [...new Set(writes.map((write) => write.tab))],
    );
  }

  async appendRow(tab: string, row: unknown[]) {
    await this.call(
      () =>
        this.api.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `${quote(tab)}!A1`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [row] },
        }),
      [tab],
    );
  }

  async cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ) {
    const props = (await this.sheetProps()).find((sheet) => sheet.title === tab);
    if (!props) {
      resetBootstrap(this);
      throw tabMissing(tab);
    }
    const { sheetId } = props;

    const rowRange = (row: number) => ({
      sheetId,
      startRowIndex: row - 1,
      endRowIndex: row,
    });
    const cellRange = (col: number) => ({
      ...rowRange(toRow),
      startColumnIndex: col,
      endColumnIndex: col + 1,
    });

    const requests: sheets_v4.Schema$Request[] = [];
    if (toRow > props.rowCount) {
      requests.push({
        appendDimension: { sheetId, dimension: "ROWS", length: toRow - props.rowCount },
      });
    }
    requests.push({
      copyPaste: {
        source: rowRange(fromRow),
        destination: rowRange(toRow),
        pasteType: "PASTE_NORMAL",
        pasteOrientation: "NORMAL",
      },
    });
    for (const col of clearCols) {
      requests.push({
        updateCells: { range: cellRange(col), rows: [{ values: [{}] }], fields: "userEnteredValue" },
      });
    }
    for (const { col, value } of overrides) {
      requests.push({
        updateCells: {
          range: cellRange(col),
          rows: [{ values: [{ userEnteredValue: extendedValue(value) }] }],
          fields: "userEnteredValue",
        },
      });
    }

    await this.call(
      () =>
        this.api.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests },
        }),
      [tab],
    );
  }
}
