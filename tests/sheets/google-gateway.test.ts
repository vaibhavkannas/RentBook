import type { sheets_v4 } from "@googleapis/sheets";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";

/** A stand-in for the Google client that records the requests it receives. */
function mockApi(
  overrides: { rowCount?: number; failWith?: unknown; valuesGetFailWith?: unknown } = {},
) {
  const get = vi.fn(async (): Promise<{ data: sheets_v4.Schema$Spreadsheet }> => {
    if (overrides.failWith) throw overrides.failWith;
    return {
      data: {
        sheets: [
          { properties: { sheetId: 11, title: "Schedule", gridProperties: { rowCount: overrides.rowCount ?? 1000 } } },
          { properties: { sheetId: 22, title: "Payments Log", gridProperties: { rowCount: 1000 } } },
        ],
      },
    };
  });
  const valuesGet = vi.fn(async () => {
    if (overrides.valuesGetFailWith) throw overrides.valuesGetFailWith;
    return { data: { values: [["a", 1]] } };
  });
  const valuesBatchGet = vi.fn(
    async (request: { ranges: string[] }): Promise<{ data: sheets_v4.Schema$BatchGetValuesResponse }> => ({
      data: { valueRanges: request.ranges.map((range, index) => ({ range, values: [[`answer ${index}`]] })) },
    }),
  );
  const valuesBatchUpdate = vi.fn(async () => ({}));
  const valuesAppend = vi.fn(async () => ({}));
  const batchUpdate = vi.fn(async () => ({}));
  const api = {
    spreadsheets: {
      get,
      batchUpdate,
      values: {
        get: valuesGet,
        batchGet: valuesBatchGet,
        batchUpdate: valuesBatchUpdate,
        append: valuesAppend,
      },
    },
  } as unknown as sheets_v4.Sheets;
  return { api, get, valuesGet, valuesBatchGet, valuesBatchUpdate, valuesAppend, batchUpdate };
}

type SentBatch = [{ requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }];

describe("GoogleSheetsGateway.getManyValues", () => {
  const requests = [
    { tab: "Settings", a1: "A1:G50" },
    { tab: "Payments Log", a1: "A1:ZZ" },
    { tab: "Owner's rent", a1: "A1:O" },
  ];

  it("reads every range with ONE batchGet, quoted, in the render asked and with serial dates", async () => {
    const { api, valuesBatchGet, valuesGet } = mockApi();
    await new GoogleSheetsGateway(api, "sheet-id").getManyValues(requests, "UNFORMATTED_VALUE");
    expect(valuesBatchGet).toHaveBeenCalledTimes(1);
    expect(valuesBatchGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      ranges: ["'Settings'!A1:G50", "'Payments Log'!A1:ZZ", "'Owner''s rent'!A1:O"],
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    expect(valuesGet).not.toHaveBeenCalled();
  });

  it("answers in the order asked, and with no rows for a range that has no values", async () => {
    const { api, valuesBatchGet } = mockApi();
    valuesBatchGet.mockResolvedValueOnce({
      data: { valueRanges: [{ values: [["a", 1]] }, { range: "'Payments Log'!A1:ZZ" }, { values: [["x"], []] }] },
    });
    expect(await new GoogleSheetsGateway(api, "sheet-id").getManyValues(requests, "FORMULA")).toEqual([
      [["a", 1]],
      [],
      [["x"], []],
    ]);
  });

  it("answers an empty list without calling Google, and an answer with too few ranges as empty ones", async () => {
    const { api, valuesBatchGet } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    expect(await gateway.getManyValues([], "FORMULA")).toEqual([]);
    expect(valuesBatchGet).not.toHaveBeenCalled();
    valuesBatchGet.mockResolvedValueOnce({ data: {} });
    expect(await gateway.getManyValues(requests, "FORMULA")).toEqual([[], [], []]);
  });

  it("reads a range that starts below the grid as empty, by reading the ranges one at a time", async () => {
    const { api, valuesBatchGet, valuesGet } = mockApi();
    valuesBatchGet.mockRejectedValueOnce(
      Object.assign(new Error("Range ('Schedule'!A6:ZZ6) exceeds grid limits. Max rows: 5, max columns: 26"), {
        status: 400,
        code: 400,
      }),
    );
    valuesGet.mockRejectedValueOnce(
      Object.assign(new Error("Range ('Settings'!A9:G50) exceeds grid limits. Max rows: 5"), {
        status: 400,
        code: 400,
      }),
    );
    expect(await new GoogleSheetsGateway(api, "sheet-id").getManyValues(requests, "FORMULA")).toEqual([
      [],
      [["a", 1]],
      [["a", 1]],
    ]);
    expect(valuesGet).toHaveBeenCalledTimes(3);
  });

  it("names the tab Google says is missing, and translates other failures as for any read", async () => {
    const { api, valuesBatchGet } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    valuesBatchGet.mockRejectedValueOnce(
      Object.assign(new Error("Unable to parse range: 'Payments Log'!A1:ZZ"), { status: 400, code: 400 }),
    );
    const error = await gateway.getManyValues(requests, "FORMULA").then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error!.code).toBe("sheet-structure");
    expect(error!.message).toMatch(/tab "Payments Log" was not found/);

    valuesBatchGet.mockRejectedValueOnce({ status: 403, code: 403, message: "The caller does not have permission" });
    await expect(gateway.getManyValues(requests, "FORMULA")).rejects.toThrow(/Google denied access/);
  });
});

describe("GoogleSheetsGateway remembers sheet ids and row counts", () => {
  it("looks them up once for several clones", async () => {
    const { api, get, batchUpdate } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.cloneRow("Schedule", 5, 6, [], []);
    await gateway.cloneRow("Schedule", 6, 7, [], []);
    expect(get).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(2);
  });

  it("counts the rows it added itself, so the next clone adds only what is still missing", async () => {
    const { api, batchUpdate } = mockApi({ rowCount: 5 });
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.cloneRow("Schedule", 5, 6, [], []);
    await gateway.cloneRow("Schedule", 6, 7, [], []);
    await gateway.cloneRow("Schedule", 7, 7, [], []);
    const sent = (index: number) => (batchUpdate.mock.calls[index] as unknown as SentBatch)[0].requestBody.requests!;
    expect(sent(0)[0].appendDimension).toEqual({ sheetId: 11, dimension: "ROWS", length: 1 });
    expect(sent(1)[0].appendDimension).toEqual({ sheetId: 11, dimension: "ROWS", length: 1 });
    expect(sent(2)[0].appendDimension).toBeUndefined();
  });

  it("listTabs always asks Google, and what it learns replaces what was remembered", async () => {
    const { api, get } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.listTabs();
    await gateway.listTabs();
    expect(get).toHaveBeenCalledTimes(2);
    await gateway.cloneRow("Schedule", 5, 6, [], []);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("looks again once when the tab asked for is not among those remembered", async () => {
    const { api, get, batchUpdate } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.cloneRow("Schedule", 5, 6, [], []);
    get.mockResolvedValueOnce({
      data: {
        sheets: [
          { properties: { sheetId: 11, title: "Schedule", gridProperties: { rowCount: 1000 } } },
          { properties: { sheetId: 33, title: "Late Rent", gridProperties: { rowCount: 1000 } } },
        ],
      },
    });
    await gateway.cloneRow("Late Rent", 2, 3, [], []);
    expect(get).toHaveBeenCalledTimes(2);
    const request = (batchUpdate.mock.calls[1] as unknown as SentBatch)[0].requestBody.requests![0];
    expect(request.copyPaste?.destination?.sheetId).toBe(33);
    // a tab that is nowhere is reported as missing after one more look, not before
    await expect(gateway.cloneRow("Nope", 2, 3, [], [])).rejects.toThrow(/tab "Nope" was not found/);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("forgets them when Google says a tab is gone", async () => {
    const { api, get, valuesGet } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.cloneRow("Schedule", 5, 6, [], []);
    valuesGet.mockRejectedValueOnce(
      Object.assign(new Error("Unable to parse range: Schedule!A1"), { status: 400, code: 400 }),
    );
    await expect(gateway.getValues("Schedule", "A1", "FORMULA")).rejects.toThrow(/was not found/);
    await gateway.cloneRow("Schedule", 6, 7, [], []);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("forgets them when a tab is added, and when a clone fails", async () => {
    const { api, get, batchUpdate } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.cloneRow("Schedule", 5, 6, [], []);
    await gateway.addTab("Settings");
    await gateway.cloneRow("Schedule", 6, 7, [], []);
    expect(get).toHaveBeenCalledTimes(2);

    batchUpdate.mockRejectedValueOnce(Object.assign(new Error("No grid with id: 11"), { status: 400, code: 400 }));
    await expect(gateway.cloneRow("Schedule", 7, 8, [], [])).rejects.toThrow();
    await gateway.cloneRow("Schedule", 7, 8, [], []);
    expect(get).toHaveBeenCalledTimes(3);
  });
});

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

  it("reads a range that starts below the last row of the grid as empty", async () => {
    const { api } = mockApi({
      valuesGetFailWith: Object.assign(
        new Error("Range ('Schedule'!A6:ZZ6) exceeds grid limits. Max rows: 5, max columns: 26"),
        { status: 400, code: 400 },
      ),
    });
    expect(await new GoogleSheetsGateway(api, "sheet-id").getValues("Schedule", "A6:ZZ6", "FORMULA")).toEqual([]);
  });

  it("still translates other read failures", async () => {
    const { api } = mockApi({
      valuesGetFailWith: Object.assign(new Error("Invalid value at 'data'"), {
        status: 400,
        code: 400,
        config: { url: "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/x" },
      }),
    });
    const error = await new GoogleSheetsGateway(api, "sheet-id")
      .getValues("Schedule", "A1", "FORMULA")
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(error?.message).toBe("Google Sheets request failed (HTTP 400): Invalid value at 'data'");
    expect("config" in (error as object)).toBe(false);
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
