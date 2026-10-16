import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { retryLogRow, type LogRow, type SheetsContext } from "@/lib/sheets/service";
import { LOG_HEADERS, LOG_TAB, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid, TOTAL_HEADER } from "../support/fixtures";
import { loggedLines } from "../support/logs";

const ROW: LogRow = [
  "2026-10-05T04:30:00.000Z",
  "2026-10",
  "First floor, single bedroom",
  "Asha",
  5450,
  4,
  "2026-10-05",
  "member@example.com",
  "Logged",
];

/** A Payments Log row for `second` seconds past 04:00, so each one has its own saved-at. */
const other = (second: number): LogRow => [
  `2026-10-04T04:00:${String(second).padStart(2, "0")}.000Z`,
  "2026-10",
  "Ground floor",
  "Hari",
  9000,
  2,
  "2026-10-04",
  "owner@example.com",
  "Logged",
];

function setup(existing: unknown[][] = []) {
  const fake = new FakeGateway({
    Schedule: baseSchedule(),
    [SETTINGS_TAB]: settingsGrid(),
    [LOG_TAB]: [[...LOG_HEADERS], ...existing],
  });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  const logRows = () => fake.tabs.get(LOG_TAB)!.slice(1);
  return { fake, ctx, logRows };
}

let log: MockInstance<typeof console.error>;
beforeEach(() => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

describe("retryLogRow", () => {
  it("adds the row when it is not in the log", async () => {
    const { ctx, logRows } = setup([other(1)]);
    expect(await retryLogRow(ctx, ROW, 0)).toBe(true);
    expect(logRows()).toEqual([other(1), ROW]);
  });

  it("does not add a row the log already holds: a replay is a success that changes nothing", async () => {
    const { ctx, logRows } = setup();
    expect(await retryLogRow(ctx, ROW, 0)).toBe(true);
    expect(await retryLogRow(ctx, ROW, 0)).toBe(true);
    expect(await retryLogRow(ctx, ROW, 0)).toBe(true);
    expect(logRows()).toEqual([ROW]);
  });

  it("does not add the row when an earlier try landed although it reported a failure", async () => {
    const { ctx, logRows } = setup([ROW]);
    expect(await retryLogRow(ctx, [...ROW], 0)).toBe(true);
    expect(logRows()).toHaveLength(1);
  });

  it("counts a row as the same when saved-at, month, portion and action match, whoever logged it", async () => {
    const { ctx, logRows } = setup([ROW]);
    const sameButLoggedByAnother: LogRow = [...ROW];
    sameButLoggedByAnother[3] = "Someone else";
    sameButLoggedByAnother[4] = 1;
    sameButLoggedByAnother[7] = "owner@example.com";
    expect(await retryLogRow(ctx, sameButLoggedByAnother, 0)).toBe(true);
    expect(logRows()).toHaveLength(1);
  });

  it.each([
    ["saved-at", 0, "2026-10-05T04:30:01.000Z"],
    ["month", 1, "2026-09"],
    ["portion", 2, "Ground floor"],
    ["action", 8, "Undone"],
  ] as const)("adds the row when only the %s differs", async (_name, index, value) => {
    const { ctx, logRows } = setup([ROW]);
    const different = [...ROW] as LogRow;
    (different as unknown[])[index] = value;
    expect(await retryLogRow(ctx, different, 0)).toBe(true);
    expect(logRows()).toEqual([ROW, different]);
  });

  it("looks only at the last 30 rows of the log", async () => {
    const recent = setup([ROW, ...Array.from({ length: 29 }, (_, i) => other(i))]);
    expect(await retryLogRow(recent.ctx, ROW, 0)).toBe(true);
    expect(recent.logRows()).toHaveLength(30); // it is the 30th from the end: found

    const old = setup([ROW, ...Array.from({ length: 30 }, (_, i) => other(i))]);
    expect(await retryLogRow(old.ctx, ROW, 0)).toBe(true);
    expect(old.logRows()).toHaveLength(32); // 31st from the end: beyond the window, so it is added
  });

  it("reads numbers and text in the Sheet as text when it compares", async () => {
    const { ctx, logRows } = setup([[...ROW.slice(0, 8), "Logged"]]);
    expect(await retryLogRow(ctx, ROW, 0)).toBe(true);
    expect(logRows()).toHaveLength(1);
  });

  it("adds the row once when two retries arrive together", async () => {
    const { ctx, logRows } = setup();
    const results = await Promise.all([retryLogRow(ctx, ROW, 0), retryLogRow(ctx, ROW, 0)]);
    expect(results).toEqual([true, true]);
    expect(logRows()).toEqual([ROW]);
  });

  it("says the row is not known to be there, and adds nothing, when the log cannot be read", async () => {
    const { fake, ctx, logRows } = setup();
    // The tabs are checked first, so only the check of the log fails.
    await retryLogRow(ctx, other(1), 0);
    fake.failOn.add("getValues");
    expect(await retryLogRow(ctx, ROW, 0)).toBe(false);
    fake.failOn.clear();
    expect(logRows()).toEqual([other(1)]);
    const lines = loggedLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "payments-log-check-failed" });
    expect(String(lines[0].message)).toMatch(/nothing was added/);
  });

  it("does not log the row, nor what the failing read carries, when the log cannot be read", async () => {
    const { fake, ctx } = setup();
    await retryLogRow(ctx, other(1), 0);
    fake.getValues = async () => {
      throw Object.assign(new Error("socket hang up"), {
        details: { tenant: "Asha" },
        config: { headers: { Authorization: "Bearer canary-token" } },
      });
    };
    expect(await retryLogRow(ctx, ROW, 0)).toBe(false);
    const [line] = loggedLines(log);
    expect(line).not.toHaveProperty("code");
    expect(String(line.message)).toContain("Error: socket hang up");
    const text = log.mock.calls.flat().join(" ");
    expect(text).not.toMatch(/Asha|5450|member@example\.com|canary-token|Bearer|Authorization/);
  });

  it("still gives up quietly when the append itself fails", async () => {
    const { fake, ctx, logRows } = setup();
    fake.failOn.add("appendRow");
    expect(await retryLogRow(ctx, ROW, 0)).toBe(false);
    fake.failOn.clear();
    expect(logRows()).toEqual([]);
    expect(await retryLogRow(ctx, ROW, 0)).toBe(true);
    expect(logRows()).toEqual([ROW]);
  });
});
