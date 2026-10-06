import { describe, expect, it } from "vitest";
import { readActivity, type SheetsContext } from "@/lib/sheets/service";
import { LOG_HEADERS, LOG_TAB } from "@/lib/sheets/settings-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

function setup(logRows: unknown[][]) {
  const fake = new FakeGateway({ Schedule: baseSchedule(), [LOG_TAB]: [[...LOG_HEADERS], ...logRows] });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const row = (n: number, extra: unknown[] = ["owner@example.com", "Logged"]) => [
  `2026-10-0${n}T04:30:00.000Z`, "2026-10", "First floor, single bedroom", "Asha", 5450, n, `2026-10-0${n}`, ...extra,
];

describe("readActivity", () => {
  it("returns the newest rows first", async () => {
    const { ctx } = setup([row(1), row(2), row(3)]);
    const items = await readActivity(ctx);
    expect(items.map((i) => i.count)).toEqual([3, 2, 1]);
    expect(items[0]).toEqual({
      savedAt: "2026-10-03T04:30:00.000Z",
      month: "2026-10",
      portion: "First floor, single bedroom",
      tenant: "Asha",
      amount: 5450,
      count: 3,
      dateReceived: "2026-10-03",
      loggedBy: "owner@example.com",
      action: "Logged",
    });
  });

  it("limits the number of rows", async () => {
    const { ctx } = setup(Array.from({ length: 7 }, (_, i) => row(i + 1)));
    expect(await readActivity(ctx, 3)).toHaveLength(3);
  });

  it("returns at most 50 rows when no limit is given, newest first", async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => [
      `2026-10-05T04:30:${String(i).padStart(2, "0")}.000Z`,
      "2026-10",
      "First floor, single bedroom",
      "Asha",
      5450,
      i + 1,
      "2026-10-05",
      "owner@example.com",
      "Logged",
    ]);
    const { ctx } = setup(sixty);
    const items = await readActivity(ctx);
    expect(items).toHaveLength(50);
    expect(items[0].count).toBe(60);
    expect(items[49].count).toBe(11);
    expect(items.map((i) => i.count)).toEqual(Array.from({ length: 50 }, (_, i) => 60 - i));
  });

  it("treats rows from before the new columns as logged by nobody, with no action", async () => {
    const { ctx } = setup([row(1, [])]);
    const [item] = await readActivity(ctx);
    expect(item.loggedBy).toBe("");
    expect(item.action).toBeNull();
  });

  it("gives a blank or unknown Action no action instead of calling it Logged", async () => {
    const { ctx } = setup([
      row(1, ["a@example.com", ""]),
      row(2, ["b@example.com", "Archived"]),
      row(3, ["c@example.com", "Logged"]),
    ]);
    const items = await readActivity(ctx);
    expect(items.map((i) => i.action)).toEqual(["Logged", null, null]);
  });

  it("keeps Edited and Undone actions and ignores blank rows", async () => {
    const { ctx } = setup([row(1, ["a@example.com", "Edited"]), [], row(2, ["b@example.com", "Undone"])]);
    const items = await readActivity(ctx);
    expect(items.map((i) => i.action)).toEqual(["Undone", "Edited"]);
  });

  it("returns an empty list for an empty log", async () => {
    const { ctx } = setup([]);
    expect(await readActivity(ctx)).toEqual([]);
  });
});
