import type { sheets_v4 } from "@googleapis/sheets";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { ensureTabs } from "@/lib/sheets/settings-store";

const MISSING_TAB = (tab: string) =>
  `The tab "${tab}" was not found in your Sheet. Restore it from File > Version history or rename it back.`;
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789SECRETID";

/** Shaped like a GaxiosError: it carries the request, whose URL holds the Sheet ID. */
function googleError(status: number, message: string) {
  return Object.assign(new Error(message), {
    status,
    code: status,
    config: { url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/x` },
  });
}

/** A Google client stand-in whose spreadsheet has the four app tabs, and whose calls can be made to fail. */
function mockApi(tabs = ["Schedule", "Settings", "Payments Log", "Tenants"]) {
  const get = vi.fn(async () => ({
    data: {
      sheets: tabs.map((title, index) => ({
        properties: { sheetId: 10 + index, title, gridProperties: { rowCount: 1000 } },
      })),
    },
  }));
  const failure: { next: unknown } = { next: null };
  const maybeFail = () => {
    if (failure.next) {
      const error = failure.next;
      failure.next = null;
      throw error;
    }
  };
  const valuesGet = vi.fn(async (request: { range: string }) => {
    maybeFail();
    // A tab with one portion row, and headers that are already right, so the app tabs need nothing written.
    if (request.range.startsWith("'Settings'")) {
      return { data: { values: [["Portion"], ["p1", "Ground", "Tenant", "Count", "Amount", 11, 5]] } };
    }
    if (request.range.startsWith("'Payments Log'")) {
      return {
        data: {
          values: [
            ["Saved at", "Month", "Portion", "Tenant", "Amount", "Count", "Date received", "Logged by", "Action"],
          ],
        },
      };
    }
    return { data: { values: [["a", 1]] } };
  });
  const valuesBatchUpdate = vi.fn(async () => {
    maybeFail();
    return {};
  });
  const valuesAppend = vi.fn(async () => {
    maybeFail();
    return {};
  });
  const batchUpdate = vi.fn(async () => {
    maybeFail();
    return {};
  });
  const api = {
    spreadsheets: {
      get,
      batchUpdate,
      values: { get: valuesGet, batchUpdate: valuesBatchUpdate, append: valuesAppend },
    },
  } as unknown as sheets_v4.Sheets;
  return { api, get, valuesGet, valuesBatchUpdate, valuesAppend, batchUpdate, failure };
}

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).not.toBeNull();
  return error as Error;
}

describe("a tab that was removed or renamed while the app is running", () => {
  it.each([
    ["Unable to parse range: 'Schedule'!A1:ZZ", 400],
    ["Requested entity was not found.", 400],
  ])("maps Google's %j to a sheet-structure error that names the tab", async (message, status) => {
    const { api, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    failure.next = googleError(status, message);
    const error = await failureOf(gateway.getValues("Schedule", "A1:ZZ", "UNFORMATTED_VALUE"));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sheet-structure");
    expect(error.message).toBe(MISSING_TAB("Schedule"));
    expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
  });

  it("names the tab each kind of call was asked for", async () => {
    const { api, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");

    failure.next = googleError(400, "Unable to parse range: 'Payments Log'!A1");
    expect((await failureOf(gateway.appendRow("Payments Log", ["x"]))).message).toBe(MISSING_TAB("Payments Log"));

    failure.next = googleError(400, "Unable to parse range: 'Tenants'!D5");
    expect(
      (await failureOf(gateway.updateValues([{ tab: "Tenants", a1: "D5", values: [["x"]] }]))).message,
    ).toBe(MISSING_TAB("Tenants"));

    failure.next = googleError(400, "Requested entity was not found.");
    expect((await failureOf(gateway.cloneRow("Schedule", 5, 6, [], []))).message).toBe(MISSING_TAB("Schedule"));
  });

  it("picks the tab Google names when one write touches several tabs", async () => {
    const { api, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    failure.next = googleError(400, "Unable to parse range: 'Settings'!A1");
    const error = await failureOf(
      gateway.updateValues([
        { tab: "Schedule", a1: "A1", values: [["x"]] },
        { tab: "Settings", a1: "A1", values: [["y"]] },
      ]),
    );
    expect(error.message).toBe(MISSING_TAB("Settings"));
  });

  it("does not guess a tab when several were written and Google names none of them", async () => {
    const { api, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    failure.next = googleError(400, "Unable to parse range: Elsewhere!A1");
    const error = await failureOf(
      gateway.updateValues([
        { tab: "Schedule", a1: "A1", values: [["x"]] },
        { tab: "Settings", a1: "A1", values: [["y"]] },
      ]),
    );
    expect(error.message).not.toMatch(/was not found in your Sheet/);
    expect(error.message).toBe("Google Sheets request failed (HTTP 400): Unable to parse range: Elsewhere!A1");
  });

  it("explains a missing tab when cloning, as it already did", async () => {
    const { api } = mockApi(["Schedule"]);
    const error = await failureOf(new GoogleSheetsGateway(api, "sheet-id").cloneRow("Nope", 5, 6, [], []));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sheet-structure");
    expect(error.message).toBe(MISSING_TAB("Nope"));
  });

  it("leaves the other Google errors as they were", async () => {
    const { api, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id", "bot@proj.iam.gserviceaccount.com");

    failure.next = googleError(404, "Requested entity was not found.");
    expect((await failureOf(gateway.getValues("Schedule", "A1", "FORMULA"))).message).toBe(
      "Google could not find that Sheet. Check SHEET_ID.",
    );

    failure.next = googleError(403, "The caller does not have permission");
    expect((await failureOf(gateway.getValues("Schedule", "A1", "FORMULA"))).message).toContain(
      "bot@proj.iam.gserviceaccount.com",
    );

    failure.next = googleError(400, "Invalid value at 'data'");
    expect((await failureOf(gateway.getValues("Schedule", "A1", "FORMULA"))).message).toBe(
      "Google Sheets request failed (HTTP 400): Invalid value at 'data'",
    );

    // a 500 that happens to say the same words is not a missing tab: it is Google not responding
    const once = new GoogleSheetsGateway(api, "sheet-id", undefined, { retries: 0 });
    failure.next = googleError(500, "Unable to parse range: Schedule!A1");
    const down = await failureOf(once.getValues("Schedule", "A1", "FORMULA"));
    expect((down as AppError).code).toBe("unavailable");
    expect(down.message).toBe("Google isn't responding. Try again in a minute.");
  });

  it("still reads a range below the grid as empty", async () => {
    const { api, failure } = mockApi();
    failure.next = googleError(400, "Range ('Schedule'!A6:ZZ6) exceeds grid limits. Max rows: 5, max columns: 26");
    expect(await new GoogleSheetsGateway(api, "sheet-id").getValues("Schedule", "A6:ZZ6", "FORMULA")).toEqual([]);
  });
});

describe("the tab check is run again after a tab goes missing", () => {
  it("checks the tabs once, remembers, and checks again after a tab error", async () => {
    const { api, get, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");

    await ensureTabs(gateway, "Schedule");
    expect(get).toHaveBeenCalledTimes(1);
    await ensureTabs(gateway, "Schedule");
    expect(get).toHaveBeenCalledTimes(1);

    failure.next = googleError(400, "Unable to parse range: 'Payments Log'!A1");
    await failureOf(gateway.appendRow("Payments Log", ["x"]));

    await ensureTabs(gateway, "Schedule");
    expect(get).toHaveBeenCalledTimes(2);
    await ensureTabs(gateway, "Schedule");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does the same when a clone finds the tab gone", async () => {
    const { api, get } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await ensureTabs(gateway, "Schedule");
    await failureOf(gateway.cloneRow("Gone", 5, 6, [], []));
    await ensureTabs(gateway, "Schedule");
    // one listing for the bootstrap, one for the clone's own lookup, one for the bootstrap that follows
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("does not forget the check for a failure that is not about a tab", async () => {
    const { api, get, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await ensureTabs(gateway, "Schedule");
    failure.next = googleError(500, "Internal error encountered.");
    await failureOf(gateway.appendRow("Payments Log", ["x"]));
    failure.next = googleError(400, "Invalid value at 'data'");
    await failureOf(gateway.getValues("Schedule", "A1", "FORMULA"));
    await ensureTabs(gateway, "Schedule");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("then refuses a Settings tab that is gone, and puts nothing back", async () => {
    const { api, get, batchUpdate, failure } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await ensureTabs(gateway, "Schedule");
    failure.next = googleError(400, "Unable to parse range: 'Settings'!A1:G50");
    await failureOf(gateway.getValues("Settings", "A1:G50", "UNFORMATTED_VALUE"));

    get.mockImplementation(async () => ({
      data: {
        sheets: ["Schedule", "Payments Log", "Tenants"].map((title, index) => ({
          properties: { sheetId: index, title, gridProperties: { rowCount: 1000 } },
        })),
      },
    }));
    const error = await failureOf(ensureTabs(gateway, "Schedule"));
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toMatch(/The Settings tab is missing/);
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});
