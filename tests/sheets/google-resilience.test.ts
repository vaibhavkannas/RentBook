import type { sheets_v4 } from "@googleapis/sheets";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { GoogleSheetsGateway, retryDelayMs } from "@/lib/sheets/google-gateway";

const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789SECRETID";

/** Shaped like a GaxiosError: it carries the request, whose URL holds the Sheet ID. */
function googleError(fields: { status?: number; code?: string | number; message?: string; cause?: unknown }) {
  return Object.assign(new Error(fields.message ?? "Backend Error"), {
    ...fields,
    config: { url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/x` },
  });
}
const http = (status: number, message?: string) => googleError({ status, code: status, message });

/** A Google client stand-in where each call can be told to fail, once or for good. */
function makeApi(rowCount = 1000) {
  const get = vi.fn(async () => ({
    data: {
      sheets: [
        { properties: { sheetId: 11, title: "Schedule", gridProperties: { rowCount } } },
        { properties: { sheetId: 22, title: "Payments Log", gridProperties: { rowCount: 1000 } } },
      ],
    },
  }));
  const valuesGet = vi.fn(async () => ({ data: { values: [["a", 1]] } }));
  const valuesBatchGet = vi.fn(async () => ({
    data: { valueRanges: [{ values: [["s"]] }, { values: [["t"]] }, {}] },
  }));
  const valuesBatchUpdate = vi.fn(async () => ({}));
  const valuesAppend = vi.fn(async () => ({}));
  const batchUpdate = vi.fn(async () => ({}));
  const api = {
    spreadsheets: {
      get,
      batchUpdate,
      values: { get: valuesGet, batchGet: valuesBatchGet, batchUpdate: valuesBatchUpdate, append: valuesAppend },
    },
  } as unknown as sheets_v4.Sheets;
  return { api, get, valuesGet, valuesBatchGet, valuesBatchUpdate, valuesAppend, batchUpdate };
}

/** A gateway that does not wait between tries, so these tests are fast. */
const quick = (api: sheets_v4.Sheets, options: { retries?: number } = {}) =>
  new GoogleSheetsGateway(api, "sheet-id", "bot@proj.iam.gserviceaccount.com", { backoffMs: () => 0, ...options });

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).not.toBeNull();
  return error as Error;
}

afterEach(() => vi.useRealTimers());

describe("reads are tried again after 429 and 5xx", () => {
  it("succeeds when a later try works, after one try and two retries at most", async () => {
    const { api, valuesGet } = makeApi();
    valuesGet.mockRejectedValueOnce(http(503)).mockRejectedValueOnce(http(500));
    expect(await quick(api).getValues("Schedule", "A1", "FORMULA")).toEqual([["a", 1]]);
    expect(valuesGet).toHaveBeenCalledTimes(3);
  });

  it("gives up after the second retry and says Google is not responding", async () => {
    const { api, valuesGet } = makeApi();
    valuesGet.mockRejectedValue(http(503));
    const error = await failureOf(quick(api).getValues("Schedule", "A1", "FORMULA"));
    expect(valuesGet).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("unavailable");
    expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
  });

  it("gives up after the second retry and says Google is limiting requests, for a 429", async () => {
    const { api, valuesGet } = makeApi();
    valuesGet.mockRejectedValue(http(429, "Quota exceeded"));
    const error = await failureOf(quick(api).getValues("Schedule", "A1", "FORMULA"));
    expect(valuesGet).toHaveBeenCalledTimes(3);
    expect((error as AppError).code).toBe("rate-limited");
  });

  it("tries again after a connection reset, but not after a timeout or a refused connection", async () => {
    const reset = makeApi();
    reset.valuesGet.mockRejectedValueOnce(googleError({ code: "ECONNRESET", message: "socket hang up" }));
    expect(await quick(reset.api).getValues("Schedule", "A1", "FORMULA")).toEqual([["a", 1]]);
    expect(reset.valuesGet).toHaveBeenCalledTimes(2);

    for (const failure of [
      googleError({ message: "The operation was aborted.", cause: { name: "AbortError" } }),
      googleError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }),
      googleError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" }),
    ]) {
      const once = makeApi();
      once.valuesGet.mockRejectedValue(failure);
      const error = await failureOf(quick(once.api).getValues("Schedule", "A1", "FORMULA"));
      expect(once.valuesGet).toHaveBeenCalledTimes(1);
      expect((error as AppError).code).toBe("unavailable");
    }
  });

  it("never repeats a request that Google refused for its content", async () => {
    for (const status of [400, 401, 403, 404]) {
      const { api, valuesGet } = makeApi();
      valuesGet.mockRejectedValue(http(status, "No"));
      await failureOf(quick(api).getValues("Schedule", "A1", "FORMULA"));
      expect(valuesGet).toHaveBeenCalledTimes(1);
    }
  });

  it("does not repeat a read of a range below the grid, and still reads it as empty", async () => {
    const { api, valuesGet } = makeApi();
    valuesGet.mockRejectedValue(http(400, "Range ('Schedule'!A6:ZZ6) exceeds grid limits. Max rows: 5"));
    expect(await quick(api).getValues("Schedule", "A6:ZZ6", "FORMULA")).toEqual([]);
    expect(valuesGet).toHaveBeenCalledTimes(1);
  });

  it("tries the number of times it is told to", async () => {
    for (const [retries, tries] of [[0, 1], [1, 2], [4, 5]]) {
      const { api, valuesGet } = makeApi();
      valuesGet.mockRejectedValue(http(503));
      await failureOf(quick(api, { retries }).getValues("Schedule", "A1", "FORMULA"));
      expect(valuesGet).toHaveBeenCalledTimes(tries);
    }
  });

  it("retries listing the tabs and a batched read the same way", async () => {
    const list = makeApi();
    list.get.mockRejectedValueOnce(http(502));
    expect(await quick(list.api).listTabs()).toEqual(["Schedule", "Payments Log"]);
    expect(list.get).toHaveBeenCalledTimes(2);

    const many = makeApi();
    many.valuesBatchGet.mockRejectedValueOnce(http(429)).mockRejectedValueOnce(http(503));
    const out = await quick(many.api).getManyValues([{ tab: "Schedule", a1: "A1" }], "FORMULA");
    expect(out).toHaveLength(1);
    expect(many.valuesBatchGet).toHaveBeenCalledTimes(3);
  });

  it("retries a write that can be repeated (values.batchUpdate), and the translated error comes last", async () => {
    const ok = makeApi();
    ok.valuesBatchUpdate.mockRejectedValueOnce(http(503));
    await quick(ok.api).updateValues([{ tab: "Schedule", a1: "A1", values: [["x"]] }]);
    expect(ok.valuesBatchUpdate).toHaveBeenCalledTimes(2);

    const bad = makeApi();
    bad.valuesBatchUpdate.mockRejectedValue(http(503));
    const error = await failureOf(quick(bad.api).updateValues([{ tab: "Schedule", a1: "A1", values: [["x"]] }]));
    expect(bad.valuesBatchUpdate).toHaveBeenCalledTimes(3);
    expect((error as AppError).code).toBe("unavailable");
  });
});

describe("writes that cannot be repeated are never tried again", () => {
  it("appendRow makes one request however Google fails", async () => {
    for (const failure of [
      http(503),
      http(429),
      http(500),
      googleError({ code: "ECONNRESET", message: "socket hang up" }),
    ]) {
      const { api, valuesAppend } = makeApi();
      valuesAppend.mockRejectedValue(failure);
      const error = await failureOf(quick(api).appendRow("Payments Log", ["x", 1]));
      expect(valuesAppend).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(AppError);
    }
  });

  it("addTab and cloneRow send their structural batchUpdate once", async () => {
    const add = makeApi();
    add.batchUpdate.mockRejectedValue(http(503));
    expect(((await failureOf(quick(add.api).addTab("Settings"))) as AppError).code).toBe("unavailable");
    expect(add.batchUpdate).toHaveBeenCalledTimes(1);

    const clone = makeApi();
    clone.batchUpdate.mockRejectedValue(http(500));
    const error = await failureOf(quick(clone.api).cloneRow("Schedule", 5, 6, [1], []));
    expect(clone.batchUpdate).toHaveBeenCalledTimes(1);
    expect((error as AppError).code).toBe("unavailable");
  });

  it("cloneRow still reads the tab list again when that read fails, but only that read", async () => {
    const { api, get, batchUpdate } = makeApi();
    get.mockRejectedValueOnce(http(503));
    await quick(api).cloneRow("Schedule", 5, 6, [], []);
    expect(get).toHaveBeenCalledTimes(2);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("the wait between tries", () => {
  it("waits backoffMs(1), then backoffMs(2), before the retries", async () => {
    vi.useFakeTimers();
    const { api, valuesGet } = makeApi();
    valuesGet.mockRejectedValue(http(503));
    const waits: number[] = [];
    const gateway = new GoogleSheetsGateway(api, "sheet-id", undefined, {
      backoffMs: (retry) => {
        waits.push(retry);
        return retry * 100;
      },
    });
    const result = failureOf(gateway.getValues("Schedule", "A1", "FORMULA"));
    await vi.advanceTimersByTimeAsync(99);
    expect(valuesGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(valuesGet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(valuesGet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(valuesGet).toHaveBeenCalledTimes(3);
    await result;
    expect(waits).toEqual([1, 2]);
  });

  it("grows by half a second to a second, with jitter, by default", () => {
    // retry 1: 250 to 500 ms; retry 2: 500 to 1000 ms; never below half of the full step
    expect(retryDelayMs(1, () => 0)).toBe(250);
    expect(retryDelayMs(1, () => 0.999999)).toBeLessThanOrEqual(500);
    expect(retryDelayMs(2, () => 0)).toBe(500);
    expect(retryDelayMs(2, () => 0.999999)).toBeLessThanOrEqual(1000);
    expect(retryDelayMs(3, () => 0)).toBeGreaterThan(retryDelayMs(2, () => 0));
    for (let retry = 1; retry <= 3; retry++) {
      const delay = retryDelayMs(retry);
      expect(delay).toBeGreaterThanOrEqual(250 * 2 ** (retry - 1));
      expect(delay).toBeLessThanOrEqual(500 * 2 ** (retry - 1));
    }
  });
});

describe("a tab error found while reading", () => {
  it("is not repeated: a missing tab will not come back by asking again", async () => {
    const { api, valuesGet } = makeApi();
    const gateway = quick(api);
    valuesGet.mockRejectedValue(http(400, "Unable to parse range: 'Payments Log'!A1:I"));
    const error = await failureOf(gateway.getValues("Payments Log", "A1:I", "FORMULA"));
    expect(valuesGet).toHaveBeenCalledTimes(1);
    expect((error as AppError).code).toBe("sheet-structure");
    expect(error.message).toMatch(/tab "Payments Log" was not found/);
  });
});
