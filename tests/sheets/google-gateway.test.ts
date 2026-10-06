import type { sheets_v4 } from "@googleapis/sheets";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";

/** A stand-in for the Google client that records the requests it receives. */
function mockApi(overrides: { rowCount?: number; failWith?: unknown } = {}) {
  const fail = async () => {
    throw overrides.failWith;
  };
  const get = overrides.failWith
    ? fail
    : vi.fn(async () => ({
        data: {
          sheets: [
            { properties: { sheetId: 11, title: "Schedule", gridProperties: { rowCount: overrides.rowCount ?? 1000 } } },
            { properties: { sheetId: 22, title: "Payments Log", gridProperties: { rowCount: 1000 } } },
          ],
        },
      }));
  const valuesGet = vi.fn(async () => ({ data: { values: [["a", 1]] } }));
  const valuesBatchUpdate = vi.fn(async () => ({}));
  const valuesAppend = vi.fn(async () => ({}));
  const batchUpdate = vi.fn(async () => ({}));
  const api = {
    spreadsheets: {
      get,
      batchUpdate,
      values: { get: valuesGet, batchUpdate: valuesBatchUpdate, append: valuesAppend },
    },
  } as unknown as sheets_v4.Sheets;
  return { api, get, valuesGet, valuesBatchUpdate, valuesAppend, batchUpdate };
}

describe("GoogleSheetsGateway", () => {
  it("lists tab titles", async () => {
    const { api } = mockApi();
    expect(await new GoogleSheetsGateway(api, "sheet-id").listTabs()).toEqual([
      "Schedule",
      "Payments Log",
    ]);
  });

  it("quotes tab names with spaces and apostrophes, and asks for serial dates", async () => {
    const { api, valuesGet } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    expect(await gateway.getValues("Payments Log", "A1:ZZ", "UNFORMATTED_VALUE")).toEqual([["a", 1]]);
    expect(valuesGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "'Payments Log'!A1:ZZ",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    await gateway.getValues("Owner's rent", "A1", "FORMULA");
    expect(valuesGet).toHaveBeenLastCalledWith(
      expect.objectContaining({ range: "'Owner''s rent'!A1" }),
    );
  });

  it("writes with RAW so text is never read as a formula", async () => {
    const { api, valuesBatchUpdate, valuesAppend } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.updateValues([{ tab: "Schedule", a1: "B6", values: [["=HYPERLINK(1)"]] }]);
    expect(valuesBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: {
        valueInputOption: "RAW",
        data: [{ range: "'Schedule'!B6", values: [["=HYPERLINK(1)"]] }],
      },
    });
    await gateway.appendRow("Payments Log", ["x", 1]);
    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'Payments Log'!A1",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [["x", 1]] },
      }),
    );
  });

  it("skips the API call for an empty write list", async () => {
    const { api, valuesBatchUpdate } = mockApi();
    await new GoogleSheetsGateway(api, "sheet-id").updateValues([]);
    expect(valuesBatchUpdate).not.toHaveBeenCalled();
  });

  it("clones a row in ONE batchUpdate: copy, then clear, then override", async () => {
    const { api, batchUpdate } = mockApi();
    await new GoogleSheetsGateway(api, "sheet-id").cloneRow("Schedule", 5, 6, [1, 2], [
      { col: 0, value: "Oct-26" },
      { col: 3, value: 42 },
    ]);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    const { requests } = (batchUpdate.mock.calls[0] as unknown as [{ requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }])[0].requestBody;
    expect(requests).toHaveLength(5);
    expect(requests![0]).toEqual({
      copyPaste: {
        source: { sheetId: 11, startRowIndex: 4, endRowIndex: 5 },
        destination: { sheetId: 11, startRowIndex: 5, endRowIndex: 6 },
        pasteType: "PASTE_NORMAL",
        pasteOrientation: "NORMAL",
      },
    });
    expect(requests![1]).toEqual({
      updateCells: {
        range: { sheetId: 11, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 2 },
        rows: [{ values: [{}] }],
        fields: "userEnteredValue",
      },
    });
    expect(requests![2].updateCells).toEqual({
      range: { sheetId: 11, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 2, endColumnIndex: 3 },
      rows: [{ values: [{}] }],
      fields: "userEnteredValue",
    });
    expect(requests![3].updateCells).toEqual({
      range: { sheetId: 11, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 1 },
      rows: [{ values: [{ userEnteredValue: { stringValue: "Oct-26" } }] }],
      fields: "userEnteredValue",
    });
    expect(requests![4].updateCells).toEqual({
      range: { sheetId: 11, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 3, endColumnIndex: 4 },
      rows: [{ values: [{ userEnteredValue: { numberValue: 42 } }] }],
      fields: "userEnteredValue",
    });
  });

  it("adds a tab with one addSheet request", async () => {
    const { api, batchUpdate } = mockApi();
    await new GoogleSheetsGateway(api, "sheet-id").addTab("Settings");
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: { requests: [{ addSheet: { properties: { title: "Settings" } } }] },
    });
  });

  it("adds grid rows first when the new row is past the end of the sheet", async () => {
    const { api, batchUpdate } = mockApi({ rowCount: 5 });
    await new GoogleSheetsGateway(api, "sheet-id").cloneRow("Schedule", 5, 6, [], []);
    const { requests } = (batchUpdate.mock.calls[0] as unknown as [{ requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }])[0].requestBody;
    expect(requests![0]).toEqual({
      appendDimension: { sheetId: 11, dimension: "ROWS", length: 1 },
    });
    expect(requests![1].copyPaste).toBeDefined();
  });

  it("explains a missing tab", async () => {
    const { api } = mockApi();
    await expect(
      new GoogleSheetsGateway(api, "sheet-id").cloneRow("Nope", 5, 6, [], []),
    ).rejects.toThrow(/tab "Nope" was not found/);
  });

  it("translates Google errors into actionable messages", async () => {
    const { api } = mockApi({ failWith: { code: 403, message: "The caller does not have permission" } });
    const gateway = new GoogleSheetsGateway(api, "sheet-id", "bot@proj.iam.gserviceaccount.com");
    const error = await gateway.listTabs().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toContain("bot@proj.iam.gserviceaccount.com");
  });

  it("rejects a service account key that is not JSON, with a hint, without echoing the key", () => {
    expect(() => GoogleSheetsGateway.fromServiceAccount("{oops", "id")).toThrow(
      /not valid JSON.*without surrounding quotes/,
    );
    let message = "";
    try {
      GoogleSheetsGateway.fromServiceAccount('{"private_key": "SECRET-KEY-TEXT", oops', "id");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/not valid JSON/);
    expect(message).not.toContain("SECRET-KEY-TEXT");
  });

  it("rejects JSON that is not a service account key", () => {
    for (const text of ["null", "42", '"text"', "{}", '{"client_email":"bot@proj.iam.gserviceaccount.com"}']) {
      expect(() => GoogleSheetsGateway.fromServiceAccount(text, "id")).toThrow(
        /client_email and private_key/,
      );
    }
  });

  it("accepts a key with client_email and private_key without calling Google", () => {
    const key = JSON.stringify({
      client_email: "bot@proj.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    });
    expect(GoogleSheetsGateway.fromServiceAccount(key, "id")).toBeInstanceOf(GoogleSheetsGateway);
  });
});
