import { describe, expect, it } from "vitest";
import {
  ensureTenancyLogTab,
  parseTenancyLog,
  TENANCY_LOG_HEADERS,
  TENANCY_LOG_RANGE,
  TENANCY_LOG_TAB,
} from "@/lib/sheets/tenancy-log-store";
import { FakeGateway } from "../support/fake-gateway";

// The Tenancy Log tab: the app's own tab that holds one row for every detail a save changed. Its headers, how it is made
// when it is missing (never over anything that is there), and how its rows are read back.

const headers = () => [...TENANCY_LOG_HEADERS];

describe("the tab", () => {
  it("is called Tenancy Log, with eight headers in columns A to H", () => {
    expect(TENANCY_LOG_TAB).toBe("Tenancy Log");
    expect(TENANCY_LOG_HEADERS).toEqual([
      "Saved at",
      "Tenancy ID",
      "Portion",
      "Action",
      "Field",
      "Old value",
      "New value",
      "Changed by",
    ]);
    expect(TENANCY_LOG_RANGE).toBe("A1:H");
  });
});

describe("ensureTenancyLogTab", () => {
  it("adds a missing tab and writes its headers, and says it created it", async () => {
    const fake = new FakeGateway({ Schedule: [] });
    expect(await ensureTenancyLogTab(fake, ["Schedule"])).toBe("created");
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([headers()]);
  });

  it("writes the headers into a tab that is there but empty, and says it filled it", async () => {
    const fake = new FakeGateway({ [TENANCY_LOG_TAB]: [] });
    expect(await ensureTenancyLogTab(fake, [TENANCY_LOG_TAB])).toBe("filled");
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([headers()]);
    expect(fake.calls).not.toContain("addTab");
  });

  it("leaves a tab that has content exactly as it is, whatever its headers say", async () => {
    const mine = [
      ["Saved at", "Tenancy ID", "Portion", "Action", "Field", "Old value", "New value", "Changed by"],
      ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Edited", "Agreement end", "2027-01-14", "2027-03-31", "owner@example.com"],
    ];
    for (const grid of [mine, [["my own notes"]], [["Saved at"]], [[" "]]]) {
      const fake = new FakeGateway({ [TENANCY_LOG_TAB]: structuredClone(grid) });
      expect(await ensureTenancyLogTab(fake, [TENANCY_LOG_TAB])).toBe("none");
      expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual(grid);
      expect(fake.calls).not.toContain("updateValues");
    }
  });

  it("treats a tab that another instance added a moment ago as one that was there", async () => {
    class Racing extends FakeGateway {
      async addTab(title: string) {
        this.tabs.set(title, []);
        return super.addTab(title);
      }
    }
    const fake = new Racing({ Schedule: [] });
    expect(await ensureTenancyLogTab(fake, ["Schedule"])).toBe("filled");
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([headers()]);
  });

  it("leaves what another instance has already filled in", async () => {
    class Racing extends FakeGateway {
      async addTab(title: string) {
        this.tabs.set(title, [headers(), ["x"]]);
        return super.addTab(title);
      }
    }
    const fake = new Racing({ Schedule: [] });
    expect(await ensureTenancyLogTab(fake, ["Schedule"])).toBe("none");
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([headers(), ["x"]]);
  });
});

const entry = (overrides: Partial<Record<number, unknown>> = {}) => {
  const base: unknown[] = ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Edited", "Agreement end", "2027-01-14", "2027-03-31", "owner@example.com"];
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base;
};

describe("parseTenancyLog", () => {
  it("reads each row into its eight values, oldest first as the tab holds them", () => {
    const parsed = parseTenancyLog([
      headers(),
      entry(),
      ["2026-11-04T10:00:00.000Z", "t-1", "p1", "Edited", "Advance", 20000, "", "member@example.com"],
    ]);
    expect(parsed.problem).toBeUndefined();
    expect(parsed.items).toEqual([
      {
        savedAt: "2026-11-03T09:30:00.000Z",
        tenancyId: "t-1",
        portionId: "p1",
        action: "Edited",
        field: "Agreement end",
        oldValue: "2027-01-14",
        newValue: "2027-03-31",
        changedBy: "owner@example.com",
      },
      {
        savedAt: "2026-11-04T10:00:00.000Z",
        tenancyId: "t-1",
        portionId: "p1",
        action: "Edited",
        field: "Advance",
        oldValue: 20000,
        newValue: "",
        changedBy: "member@example.com",
      },
    ]);
  });

  it("has no items and no problem for a tab with only its headers", () => {
    expect(parseTenancyLog([headers()])).toEqual({ items: [] });
  });

  it("accepts headers in any case or spacing, as the other tabs do", () => {
    const sloppy = [" saved  AT", "Tenancy ID", "PORTION", "action", "Field ", "old value", "New Value", "changed by"];
    expect(parseTenancyLog([sloppy, entry()]).items).toHaveLength(1);
  });

  it("skips blank rows, and rows of only spaces", () => {
    const parsed = parseTenancyLog([headers(), [], entry(), ["", "  ", undefined], [], entry({ 1: "t-2" })]);
    expect(parsed.items.map((item) => item.tenancyId)).toEqual(["t-1", "t-2"]);
  });

  it("keeps a row with an action it does not know, as an action of null", () => {
    const parsed = parseTenancyLog([headers(), entry({ 3: "Restored" }), entry({ 3: "" }), entry({ 3: "edited" })]);
    expect(parsed.items.map((item) => item.action)).toEqual([null, null, null]);
    expect(parsed.items[0].field).toBe("Agreement end");
  });

  it("knows the four actions", () => {
    const parsed = parseTenancyLog([headers(), ...["Added", "Edited", "Moved out", "Closed"].map((action) => entry({ 3: action }))]);
    expect(parsed.items.map((item) => item.action)).toEqual(["Added", "Edited", "Moved out", "Closed"]);
  });

  it("reads a row that stops early as blank values", () => {
    const parsed = parseTenancyLog([headers(), ["2026-11-03T09:30:00.000Z", "t-1", "p1", "Added"]]);
    expect(parsed.items).toEqual([
      {
        savedAt: "2026-11-03T09:30:00.000Z",
        tenancyId: "t-1",
        portionId: "p1",
        action: "Added",
        field: "",
        oldValue: "",
        newValue: "",
        changedBy: "",
      },
    ]);
  });

  it("names the first wrong header, in words, and gives no items", () => {
    const wrong = headers();
    wrong[3] = "Type";
    expect(parseTenancyLog([wrong, entry()])).toEqual({
      items: [],
      problem:
        'The Tenancy Log tab must have "Action" in column D (found "Type"). Put the headers back to see the history; saving changes still works.',
    });
  });

  it("says nothing was found for a missing header, and shortens a long one", () => {
    expect(parseTenancyLog([headers().slice(0, 5)]).problem).toBe(
      'The Tenancy Log tab must have "Old value" in column F (found nothing). Put the headers back to see the history; saving changes still works.',
    );
    expect(parseTenancyLog([]).problem).toContain('"Saved at" in column A (found nothing)');
    const long = headers();
    long[0] = "x".repeat(500);
    const problem = parseTenancyLog([long]).problem ?? "";
    expect(problem).toContain('"Saved at" in column A');
    expect(problem.length).toBeLessThan(400);
  });

  it("does not look at columns to the right of H", () => {
    expect(parseTenancyLog([[...headers(), "my own column"], [...entry(), "a note of mine"]]).items).toHaveLength(1);
  });
});
