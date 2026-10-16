import "server-only";
import { auth as googleAuth, sheets as createSheets, type sheets_v4 } from "@googleapis/sheets";
import { configError, tabMissing } from "@/lib/errors";
import type { CellWrite, RangeRequest, RowOverride, SheetsGateway, ValueRender } from "./gateway";
import { isTransientGoogleError, missingTabOf, translateGoogleError } from "./google-errors";
import { resetBootstrap } from "./settings-store";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

type SheetProps = { sheetId: number; title: string; rowCount: number };

/**
 * How the Google client is made. A request that has not been answered after 10 seconds is given up on (a Vercel
 * function lives 15 seconds in all). The client's own retrying is switched off: left alone it repeats every read
 * three times with delays of its own choosing, and the gateway decides for itself which calls may be repeated.
 */
export const SHEETS_CLIENT_OPTIONS = { timeout: 10_000, retryConfig: { retry: 0, noResponseRetries: 0 } };

export type GatewayOptions = {
  /** How many times a read, or a write that can safely be repeated, is tried again after the first try. Default 2. */
  retries?: number;
  /** Milliseconds to wait before retry number `retry` (1 for the first). Default: `retryDelayMs`. */
  backoffMs?: (retry: number) => number;
};

const DEFAULT_RETRIES = 2;
const BASE_DELAY_MS = 500;

/**
 * How long to wait before a retry: from half to all of 500 ms for the first, doubling with every one after. The
 * spread keeps two server instances that failed together from trying again at the same moment.
 */
export function retryDelayMs(retry: number, random: () => number = Math.random): number {
  const full = BASE_DELAY_MS * 2 ** (retry - 1);
  return full / 2 + (full / 2) * random();
}

/** Google refuses a range that starts below the last row of the grid. Nothing is stored there, so it reads as empty. */
const exceedsGrid = (error: unknown) => /exceeds grid limits/i.test(error instanceof Error ? error.message : "");

function extendedValue(value: string | number): sheets_v4.Schema$ExtendedValue {
  return typeof value === "number" ? { numberValue: value } : { stringValue: value };
}

export class GoogleSheetsGateway implements SheetsGateway {
  private readonly retries: number;
  private readonly backoffMs: (retry: number) => number;
  /**
   * The id, title and row count of every tab, as of the last time Google was asked. Cloning a row needs a tab's
   * sheetId and row count, and asking for them is a call of its own. Forgotten when a tab is added, when Google
   * says a tab is gone, and when a clone fails, so a Sheet that changed behind our back costs one failed try
   * at the most.
   */
  private props: SheetProps[] | null = null;

  constructor(
    private readonly api: sheets_v4.Sheets,
    private readonly spreadsheetId: string,
    private readonly serviceAccountEmail?: string,
    options: GatewayOptions = {},
  ) {
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.backoffMs = options.backoffMs ?? retryDelayMs;
  }

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
      createSheets({ version: "v4", auth: authClient, ...SHEETS_CLIENT_OPTIONS }),
      spreadsheetId,
      credentials.client_email,
    );
  }

  /**
   * Makes one Google call. `tabs` are the tabs the request names: a failure that says one of them does not
   * exist becomes "tab not found", and the app's tab check is run again on the next request, so a tab deleted
   * or renamed while the app runs is noticed (and a deleted Payments Log or Tenants tab put back).
   *
   * `repeatable` says the call can safely be made again: a read, or a write that sets cells to given values.
   * Only then is it tried again (up to `retries` times, after a wait) when Google says 429 or 5xx, or the
   * connection was reset. An append, or a change to the Sheet's structure, would be done twice if its first try
   * got through and only the answer was lost, so those are never repeated.
   */
  private async call<T>(run: () => Promise<T>, tabs: string[] = [], repeatable = false): Promise<T> {
    for (let retry = 0; ; retry++) {
      try {
        return await run();
      } catch (error) {
        if (repeatable && retry < this.retries && isTransientGoogleError(error)) {
          await new Promise((resolve) => setTimeout(resolve, this.backoffMs(retry + 1)));
          continue;
        }
        throw this.translate(error, tabs);
      }
    }
  }

  private translate(error: unknown, tabs: string[]): unknown {
    const tab = missingTabOf(error, tabs);
    if (tab !== null) {
      this.props = null;
      resetBootstrap(this);
    }
    return translateGoogleError(error, this.serviceAccountEmail, tab ?? undefined);
  }

  /** Asks Google for every tab's id, title and row count, and remembers the answer. */
  private async sheetProps(): Promise<SheetProps[]> {
    const { data } = await this.call(
      () =>
        this.api.spreadsheets.get({
          spreadsheetId: this.spreadsheetId,
          fields: "sheets.properties(sheetId,title,gridProperties.rowCount)",
        }),
      [],
      true,
    );
    this.props = (data.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? "",
      rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
    }));
    return this.props;
  }

  /** What is remembered about `tab`; when the tab is not among them, Google is asked once. */
  private async propsOf(tab: string): Promise<SheetProps | undefined> {
    const known = this.props?.find((sheet) => sheet.title === tab);
    return known ?? (await this.sheetProps()).find((sheet) => sheet.title === tab);
  }

  async listTabs() {
    return (await this.sheetProps()).map((sheet) => sheet.title);
  }

  async addTab(title: string) {
    this.props = null;
    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      }),
    );
  }

  private async readRange(tab: string, a1: string, render: ValueRender): Promise<unknown[][]> {
    try {
      const { data } = await this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${quote(tab)}!${a1}`,
        valueRenderOption: render,
        dateTimeRenderOption: "SERIAL_NUMBER",
      });
      return (data.values ?? []) as unknown[][];
    } catch (error) {
      // The "row under the table" check relies on this when the table fills the whole grid.
      if (exceedsGrid(error)) return [];
      throw error;
    }
  }

  async getValues(tab: string, a1: string, render: ValueRender) {
    return this.call(() => this.readRange(tab, a1, render), [tab], true);
  }

  async getManyValues(requests: RangeRequest[], render: ValueRender) {
    if (requests.length === 0) return [];
    return this.call(
      async () => {
        try {
          const { data } = await this.api.spreadsheets.values.batchGet({
            spreadsheetId: this.spreadsheetId,
            ranges: requests.map(({ tab, a1 }) => `${quote(tab)}!${a1}`),
            valueRenderOption: render,
            dateTimeRenderOption: "SERIAL_NUMBER",
          });
          // Google answers in the order asked; a range with nothing in it comes back without values.
          return requests.map((_, index) => (data.valueRanges?.[index]?.values ?? []) as unknown[][]);
        } catch (error) {
          if (!exceedsGrid(error)) throw error;
          // Google refuses all the ranges when one starts below the grid. Read them one at a time instead,
          // where that one reads as empty.
          const answers: unknown[][][] = [];
          for (const { tab, a1 } of requests) answers.push(await this.readRange(tab, a1, render));
          return answers;
        }
      },
      [...new Set(requests.map(({ tab }) => tab))],
      true,
    );
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
      true,
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
    const props = await this.propsOf(tab);
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
    const grows = toRow > props.rowCount;
    if (grows) {
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

    try {
      await this.call(
        () =>
          this.api.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: { requests },
          }),
        [tab],
      );
    } catch (error) {
      this.props = null;
      throw error;
    }
    if (grows) props.rowCount = toRow;
  }
}
