import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { CellWrite } from "@/lib/sheets/gateway";
import type { NewPortion } from "@/lib/sheets/portion-plan";
import { addPortion, reorderPortions, setPortionActive } from "@/lib/sheets/portion-service";
import { getMonthView, getSettings, loadSnapshot, logPayment, saveSettings, withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { appendTenancy, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { moveOutWithoutDetails } from "@/lib/sheets/tenancy-service";
import { cell, FakeGateway } from "../support/fake-gateway";
import { changedCells, expectOnlyPlanned, snapshotOf } from "../support/grid-diff";
import {
  baseSchedule,
  monthCell,
  scheduleRow,
  scheduleWithoutPortion,
  settingsGrid,
  settingsGridWithActive,
  TOTAL_HEADER,
} from "../support/fixtures";

// The three services that change which portions the app has: add one, switch one off or on, put them in another order. Each runs
// under the write lock, reads the Sheet fresh, writes RAW, checks what it wrote and throws the page caches away. The cells each
// change writes are decided by the planners (portion-plan.test.ts); what is tested here is the order of the calls, what a
// failure at each step leaves behind, what a refusal leaves untouched, and that the app reads the result.

const OCT = { year: 2026, month: 10 };
const SEP = { year: 2026, month: 9 };
const TODAY = "2026-10-05";
const NEW = { name: "Back room", cycleLength: 11, hikePercent: 5 };
const OPTIONS = { now: new Date("2026-10-05T04:30:00Z"), retryDelayMs: 0, loggedBy: "owner@example.com" };

const SOMEONE = "Someone changed the Settings tab a moment ago. Tap another tab at the bottom of the screen and come back, then try again.";
const HEADERS_NOT_SAVED = "The new Schedule columns may not have been saved. Check row 3 of your Schedule, then try again.";
const ROW_NOT_SAVED = "The new portion may not have been saved. Check row 7 of your Settings tab, then try again.";
const ORDER_NOT_SAVED =
  "The new order may not have been saved fully. Open the Settings tab and check the order (File > Version history can restore it).";
const STALE_IDS = "Your portions changed since this page loaded. Tap another tab at the bottom of the screen and come back, then try again.";

/** The owner's Settings tab as it is today: the seven headers A to G, H1 blank. */
const ownerSettings = settingsGrid;

/**
 * A FakeGateway that can play someone else (a person typing in the Sheet, a second server) or a Google that misbehaves:
 * `afterWrite` runs after each update, `drop` makes a tab's writes report success and store nothing, `failWrites` makes a tab's
 * writes fail, and `afterEnsure` runs after the columns were made. Nothing here changes a call's arguments.
 */
class Interfering extends FakeGateway {
  afterWrite: ((writes: CellWrite[]) => void) | null = null;
  afterEnsure: (() => void) | null = null;
  drop = new Set<string>();
  failWrites = new Set<string>();

  async updateValues(writes: CellWrite[]) {
    if (writes.some((write) => this.failWrites.has(write.tab))) {
      this.calls.push("updateValues");
      throw new Error("Google said no");
    }
    await super.updateValues(writes.filter((write) => !this.drop.has(write.tab)));
    this.afterWrite?.(writes);
  }

  async ensureColumnCount(tab: string, columns: number) {
    await super.ensureColumnCount(tab, columns);
    this.afterEnsure?.();
  }
}

type Setup = { settings?: unknown[][]; schedule?: unknown[][]; totalHeader?: string | null; gridColumns?: Record<string, number>; cached?: boolean };

/** A Sheet whose Payments Log and Tenants tabs exist already and whose call log is empty, so the calls are the service's own. */
async function ready(setup: Setup = {}) {
  const fake = new Interfering(
    { Schedule: setup.schedule ?? baseSchedule(), [SETTINGS_TAB]: setup.settings ?? ownerSettings() },
    { gridColumns: setup.gridColumns },
  );
  const plain: SheetsContext = {
    gateway: fake,
    scheduleTab: "Schedule",
    totalHeader: setup.totalHeader === undefined ? TOTAL_HEADER : setup.totalHeader,
  };
  const ctx = setup.cached ? withSnapshotCache({ ...plain }) : plain;
  // The first read adds the app's other tabs. A Sheet the app cannot read (a test's) still has them after it fails.
  await loadSnapshot(plain).catch(() => undefined);
  fake.calls.length = 0;
  return { fake, ctx };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const wrote = (fake: FakeGateway) => fake.calls.filter((call) => call === "updateValues" || call === "ensureColumnCount" || call === "cloneRow" || call === "appendRow");

describe("addPortion: the happy path", () => {
  it("writes the three headers, then the Settings row, and the app then shows the portion last, with no tenant", async () => {
    const { fake, ctx } = await ready();
    const reference = new FakeGateway(Object.fromEntries(fake.tabs));
    const result = await addPortion(ctx, NEW);

    expect(result).toEqual({
      portion: { id: "p6", name: "Back room", tenantHeader: "Tenant6", countHeader: "Count6", amountHeader: "Amount6", cycleLength: 11, hikePercent: 5 },
      columns: [
        { header: "Tenant6", letter: "R" },
        { header: "Count6", letter: "S" },
        { header: "Amount6", letter: "T" },
      ],
      totalNote:
        "Your Total Rent column adds up the amounts with a formula. Add column T (Amount6) to it in your Sheet so the total includes Back room.",
    });
    expect(fake.tabs.get("Schedule")![2].slice(16)).toEqual(["Total Rent", "Tenant6", "Count6", "Amount6"]);
    expect(fake.tabs.get(SETTINGS_TAB)![6]).toEqual(["p6", "Back room", "Tenant6", "Count6", "Amount6", 11, 5]);

    const settings = await getSettings(ctx);
    expect(settings.map((portion) => portion.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    const view = await getMonthView(ctx, OCT);
    expect(view.cards).toHaveLength(6);
    expect(view.cards[5]).toMatchObject({ portionId: "p6", name: "Back room", status: "needs-tenant" });
    expect(view.due).toBe(32885);
    // nothing else in either tab changed
    expect(changedCells(reference, fake, "Schedule")).toEqual(["R3", "S3", "T3"]);
    expect(changedCells(reference, fake, SETTINGS_TAB)).toEqual(["A7", "B7", "C7", "D7", "E7", "F7", "G7"]);
    expectOnlyPlanned(reference, fake, [
      { tab: "Schedule", a1: "R3:T3", values: [["Tenant6", "Count6", "Amount6"]] },
      { tab: SETTINGS_TAB, a1: "A7:G7", values: [["p6", "Back room", "Tenant6", "Count6", "Amount6", 11, 5]] },
    ]);
  });

  it("makes its calls in an order whose failure is always harmless: room, the header cells, the Settings row, each checked", async () => {
    const { fake, ctx } = await ready();
    await addPortion(ctx, NEW);
    expect(fake.calls).toEqual([
      "getManyValues", // the snapshot (Settings, Schedule, Tenants), which refuses a broken layout
      "getManyValues", // both tabs again with FORMULA: what the plan is made from
      "ensureColumnCount",
      "getValues", // the three header cells, read again right before they are written: they must be empty
      "updateValues", // the headers
      "getManyValues", // read back
      "getValues", // the Settings tab again: the planned row must still be empty
      "updateValues", // the Settings row, last
      "getManyValues", // read back
    ]);
  });

  it("takes the portion's name trimmed and a cycle that never resets as a blank cell", async () => {
    const { fake, ctx } = await ready();
    const result = await addPortion(ctx, { name: "  Shop  ", cycleLength: null, hikePercent: 0 });
    expect(result.portion).toMatchObject({ name: "Shop", cycleLength: null, hikePercent: 0 });
    expect(fake.tabs.get(SETTINGS_TAB)![6]).toEqual(["p6", "Shop", "Tenant6", "Count6", "Amount6", "", 0]);
    expect((await getSettings(ctx))[5]).toMatchObject({ cycleLength: null });
  });

  it("works with the Settings tab the app seeds (an Active column that is blank) as well as the owner's", async () => {
    const { fake, ctx } = await ready({ settings: settingsGridWithActive({ p2: "No" }) });
    await addPortion(ctx, NEW);
    expect(fake.tabs.get(SETTINGS_TAB)![6]).toEqual(["p6", "Back room", "Tenant6", "Count6", "Amount6", 11, 5]);
    const portions = await getSettings(ctx);
    expect(portions.map((p) => [p.id, p.inactive ?? false])).toEqual([["p1", false], ["p2", true], ["p3", false], ["p4", false], ["p5", false], ["p6", false]]);
  });

  it("lets the new portion take its first tenant, and its payment goes in its own columns", async () => {
    const { fake, ctx } = await ready();
    await addPortion(ctx, NEW);
    await logPayment(ctx, { month: OCT, portionId: "p6", amount: 4000, dateReceived: "2026-10-05", newTenantName: "Hari" }, OPTIONS);
    expect(cell(fake, "Schedule", "R", 6)).toBe("Hari");
    expect(cell(fake, "Schedule", "S", 6)).toBe(1);
    expect(cell(fake, "Schedule", "T", 6)).toBe(4000);
    // the other portions' cells in October are empty, and the Total formula was cloned as it was (the owner adds the column to it)
    expect(cell(fake, "Schedule", "D", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
    const view = await getMonthView(ctx, OCT);
    expect(view.cards[5]).toMatchObject({ portionId: "p6", status: "paid", entry: { tenant: "Hari", count: 1, amount: 4000 } });
    expect(view.received).toBe(4000);
  });

  it("adds a second portion after a first: p7 on the next columns and the next row", async () => {
    const { fake, ctx } = await ready();
    await addPortion(ctx, NEW);
    const second = await addPortion(ctx, { name: "Shop", cycleLength: 6, hikePercent: 10 });
    expect(second.portion.id).toBe("p7");
    expect(second.columns).toEqual([
      { header: "Tenant7", letter: "U" },
      { header: "Count7", letter: "V" },
      { header: "Amount7", letter: "W" },
    ]);
    expect(fake.tabs.get(SETTINGS_TAB)![7]).toEqual(["p7", "Shop", "Tenant7", "Count7", "Amount7", 6, 10]);
  });
});

describe("addPortion: room for the columns", () => {
  it("widens a Schedule that has no column R, so the write is not beyond the grid", async () => {
    const { fake, ctx } = await ready({ gridColumns: { Schedule: 17 } });
    await addPortion(ctx, NEW);
    expect(fake.gridColumns.get("Schedule")).toBe(20);
    expect(fake.calls).toContain("ensureColumnCount");
    expect(cell(fake, "Schedule", "T", 3)).toBe("Amount6");
  });

  it("leaves a Schedule that is wide enough as wide as it was", async () => {
    const { fake, ctx } = await ready({ gridColumns: { Schedule: 26 } });
    await addPortion(ctx, NEW);
    expect(fake.gridColumns.get("Schedule")).toBe(26);
  });

  it("writes nothing when the columns cannot be added: the Sheet is as it was, and the error is the gateway's own", async () => {
    const { fake, ctx } = await ready({ gridColumns: { Schedule: 17 } });
    const before = snapshotOf(fake);
    fake.failOn.add("ensureColumnCount");
    await expect(addPortion(ctx, NEW)).rejects.toThrow("ensureColumnCount failed");
    expect(wrote(fake)).toEqual(["ensureColumnCount"]);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("needs no widening when the headers are already there (an add that stopped half way)", async () => {
    const { fake, ctx } = await ready({ gridColumns: { Schedule: 17 } });
    fake.failWrites.add(SETTINGS_TAB);
    await expect(addPortion(ctx, NEW)).rejects.toThrow("Google said no");
    fake.failWrites.clear();
    fake.calls.length = 0;
    await addPortion(ctx, NEW);
    expect(fake.calls).not.toContain("ensureColumnCount");
  });
});

describe("addPortion: what the owner is told about the total", () => {
  it("says nothing when the total holds typed numbers, which the app keeps up to date, and then keeps the new portion in it", async () => {
    const schedule = baseSchedule();
    schedule[3] = scheduleRow(monthCell("text", 2026, 8), [["Asha", 2, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000], null, null], 4, 27150);
    schedule[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], null, ["Esha", 1, 5100]], 5, 32250);
    const { fake, ctx } = await ready({ schedule });
    expect((await addPortion(ctx, NEW)).totalNote).toBeNull();
    await logPayment(ctx, { month: OCT, portionId: "p6", amount: 4000, dateReceived: "2026-10-05", newTenantName: "Hari" }, OPTIONS);
    expect(cell(fake, "Schedule", "Q", 6)).toBe(4000);
  });

  it("says nothing when no total column is set", async () => {
    const { ctx } = await ready({ totalHeader: null });
    expect((await addPortion(ctx, NEW)).totalNote).toBeNull();
  });
});

describe("addPortion: someone else, and Google, between the steps", () => {
  it("is a conflict, with Settings untouched, when someone types into the planned row after the headers were written", async () => {
    const { fake, ctx } = await ready();
    fake.afterWrite = (writes) => {
      if (writes.some((write) => write.tab === "Schedule")) fake.tabs.get(SETTINGS_TAB)![6] = ["a note typed just now"];
    };
    const error = await failure(addPortion(ctx, NEW));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(SOMEONE);
    expect(fake.tabs.get(SETTINGS_TAB)![6]).toEqual(["a note typed just now"]);
    expect(fake.tabs.get(SETTINGS_TAB)).toHaveLength(7);
    // the three headers stay: harmless, and the retry takes them
    expect(fake.tabs.get("Schedule")![2].slice(17)).toEqual(["Tenant6", "Count6", "Amount6"]);
    expect(wrote(fake)).toEqual(["ensureColumnCount", "updateValues"]);
  });

  it("is the same conflict when someone adds the same id in another row", async () => {
    const { fake, ctx } = await ready();
    fake.afterWrite = (writes) => {
      if (writes.some((write) => write.tab === "Schedule")) fake.tabs.get(SETTINGS_TAB)![8] = ["p6", "Someone's", "TenantX", "CountX", "AmountX", 11, 5];
    };
    const error = await failure(addPortion(ctx, NEW));
    expect(error.message).toBe(SOMEONE);
    expect(fake.tabs.get(SETTINGS_TAB)![6]).toBeUndefined();
  });

  it("then takes the next free row and the headers already there when it is tried again", async () => {
    const { fake, ctx } = await ready();
    fake.afterWrite = (writes) => {
      if (writes.some((write) => write.tab === "Schedule")) fake.tabs.get(SETTINGS_TAB)![6] = ["a note typed just now"];
    };
    await failure(addPortion(ctx, NEW));
    fake.afterWrite = null;
    const result = await addPortion(ctx, NEW);
    expect(result.portion.id).toBe("p6");
    expect(result.columns.map((column) => column.letter)).toEqual(["R", "S", "T"]);
    expect(fake.tabs.get(SETTINGS_TAB)![6]).toEqual(["a note typed just now"]);
    expect(fake.tabs.get(SETTINGS_TAB)![7]).toEqual(["p6", "Back room", "Tenant6", "Count6", "Amount6", 11, 5]);
    expect(fake.tabs.get("Schedule")![2]).toHaveLength(20);
  });

  it("is a conflict, and writes nothing, when someone typed into the header cells after the plan was made", async () => {
    const { fake, ctx } = await ready({ gridColumns: { Schedule: 17 } });
    fake.afterEnsure = () => {
      fake.tabs.get("Schedule")![2][17] = "typed just now";
    };
    const before = snapshotOf(fake);
    const error = await failure(addPortion(ctx, NEW));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(SOMEONE.replace("Settings tab", "Schedule tab"));
    expect(wrote(fake)).toEqual(["ensureColumnCount"]);
    expect(fake.tabs.get("Schedule")![2][17]).toBe("typed just now");
    expect(fake.tabs.get(SETTINGS_TAB)).toEqual(before.find(([title]) => title === SETTINGS_TAB)![1]);
  });

  it("leaves only the three headers when the Settings write fails: the app still loads, and the retry uses them", async () => {
    const { fake, ctx } = await ready();
    fake.failWrites.add(SETTINGS_TAB);
    await expect(addPortion(ctx, NEW)).rejects.toThrow("Google said no");
    expect(fake.tabs.get("Schedule")![2].slice(17)).toEqual(["Tenant6", "Count6", "Amount6"]);
    expect(fake.tabs.get(SETTINGS_TAB)).toHaveLength(6);
    // the app is unaffected: five portions, every card as before
    const snapshot = await loadSnapshot(ctx);
    expect(snapshot.portions).toHaveLength(5);
    expect((await getMonthView(ctx, OCT)).cards).toHaveLength(5);
    expect((await getMonthView(ctx, OCT)).due).toBe(32885);

    fake.failWrites.clear();
    const result = await addPortion(ctx, NEW);
    expect(result.portion).toMatchObject({ id: "p6", tenantHeader: "Tenant6" });
    expect(result.columns.map((column) => column.letter)).toEqual(["R", "S", "T"]);
    expect(fake.tabs.get("Schedule")![2]).toHaveLength(20); // one set of headers, not two
    expect((await getMonthView(ctx, OCT)).cards).toHaveLength(6);
  });

  it("does not write the Settings row when the headers cannot be read back as written, and says where to look", async () => {
    const { fake, ctx } = await ready();
    fake.drop.add("Schedule");
    const error = await failure(addPortion(ctx, NEW));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(HEADERS_NOT_SAVED);
    expect(fake.tabs.get(SETTINGS_TAB)).toHaveLength(6);
    expect(wrote(fake)).toEqual(["ensureColumnCount", "updateValues"]);
  });

  it("does not write the Settings row when a header was changed the moment it was written", async () => {
    const { fake, ctx } = await ready();
    fake.afterWrite = (writes) => {
      if (writes.some((write) => write.tab === "Schedule")) fake.tabs.get("Schedule")![2][18] = "Count 6";
    };
    expect((await failure(addPortion(ctx, NEW))).message).toBe(HEADERS_NOT_SAVED);
    expect(fake.tabs.get(SETTINGS_TAB)).toHaveLength(6);
  });

  it("does not write the Settings row, and does not hide the failure, when the headers cannot be read back at all", async () => {
    const { fake, ctx } = await ready();
    const read = vi.spyOn(fake, "getManyValues");
    // the first two getManyValues are the snapshot and the plan's read; the third is the read-back of the headers
    read.mockImplementation(async function (this: FakeGateway, ...args) {
      if (read.mock.calls.length === 3) throw new Error("Google went away");
      return FakeGateway.prototype.getManyValues.apply(fake, args);
    });
    await expect(addPortion(ctx, NEW)).rejects.toThrow("Google went away");
    expect(fake.tabs.get(SETTINGS_TAB)).toHaveLength(6);
    expect(fake.tabs.get("Schedule")![2].slice(17)).toEqual(["Tenant6", "Count6", "Amount6"]);
  });

  it("says the portion may not have been saved when the Settings row reads back differently", async () => {
    const { fake, ctx } = await ready();
    fake.afterWrite = (writes) => {
      if (writes.some((write) => write.tab === SETTINGS_TAB)) fake.tabs.get(SETTINGS_TAB)![6][1] = "Changed under us";
    };
    const error = await failure(addPortion(ctx, NEW));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(ROW_NOT_SAVED);
  });

  it("says the same when the Settings write was dropped", async () => {
    const { fake, ctx } = await ready();
    fake.drop.add(SETTINGS_TAB);
    expect((await failure(addPortion(ctx, NEW))).message).toBe(ROW_NOT_SAVED);
  });
});

describe("addPortion: two at once", () => {
  it("gives two adds that start 1 ms apart different ids, columns and rows, and both are there afterwards", async () => {
    const { fake, ctx } = await ready();
    fake.delayMs = 1;
    const first = addPortion(ctx, { name: "Room A", cycleLength: 11, hikePercent: 5 });
    await new Promise((resolve) => setTimeout(resolve, 1));
    const second = addPortion(ctx, { name: "Room B", cycleLength: 11, hikePercent: 5 });
    const [a, b] = await Promise.all([first, second]);
    expect([a.portion.id, b.portion.id]).toEqual(["p6", "p7"]);
    expect(a.columns.map((column) => column.letter)).toEqual(["R", "S", "T"]);
    expect(b.columns.map((column) => column.letter)).toEqual(["U", "V", "W"]);
    expect(fake.tabs.get(SETTINGS_TAB)![6].slice(0, 2)).toEqual(["p6", "Room A"]);
    expect(fake.tabs.get(SETTINGS_TAB)![7].slice(0, 2)).toEqual(["p7", "Room B"]);
    const view = await getMonthView(ctx, OCT);
    expect(view.cards.map((card) => card.name).slice(5)).toEqual(["Room A", "Room B"]);
  });

  it("refuses the second when both ask for the same name", async () => {
    const { fake, ctx } = await ready();
    fake.delayMs = 1;
    const results = await Promise.allSettled([addPortion(ctx, NEW), addPortion(ctx, { ...NEW, name: "back ROOM" })]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(((results[1] as PromiseRejectedResult).reason as AppError).message).toBe('There is already a portion called "Back room". Choose a different name.');
    expect(fake.tabs.get(SETTINGS_TAB)).toHaveLength(7);
  });
});

describe("addPortion: refusals write nothing", () => {
  it("refuses a bad request before it reads anything", async () => {
    const { fake, ctx } = await ready();
    for (const request of [
      { ...NEW, name: "" },
      { ...NEW, name: "x".repeat(61) },
      { ...NEW, cycleLength: 0 },
      { ...NEW, hikePercent: 101 },
    ]) {
      expect((await failure(addPortion(ctx, request))).code).toBe("validation");
    }
    expect(fake.calls).toEqual([]);
  });

  const noRoom = () => {
    const schedule = baseSchedule();
    schedule[8] = [];
    schedule[8][699] = "x"; // column ZX: three more would pass ZZ
    return schedule;
  };
  const noFreeRow = () => {
    const settings = ownerSettings();
    for (let row = 7; row <= 50; row++) settings[row - 1] = [`note ${row}`];
    return settings;
  };

  it.each<[string, NewPortion, Setup]>([
    ["a name that is taken", { ...NEW, name: "first floor, single bedroom" }, {}],
    ["a Schedule with no room", NEW, { schedule: noRoom() }],
    ["a Settings tab with no free row", NEW, { settings: noFreeRow() }],
  ])("refuses %s, and changes nothing", async (_name, request, setup) => {
    const { fake, ctx } = await ready(setup);
    const before = snapshotOf(fake);
    const error = await failure(addPortion(ctx, request));
    expect(error.code).toBe("validation");
    expect(wrote(fake)).toEqual([]);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("refuses a Sheet the app cannot read with its own message and where to look, before it writes", async () => {
    const schedule = baseSchedule();
    (schedule[2] as string[])[7] = "Tenant three";
    const { fake, ctx } = await ready({ schedule });
    const before = snapshotOf(fake);
    const error = await failure(addPortion(ctx, NEW));
    expect(error.code).toBe("sheet-structure");
    expect(error.message).toMatch(/^Header "Tenant3" was not found in the Schedule tab\./);
    expect(error.message).toMatch(/ Set up shows what is wrong\.$/);
    expect(wrote(fake)).toEqual([]);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("does not repeat the structural call or the writes when Google fails once", async () => {
    const { fake, ctx } = await ready();
    fake.failOn.add("updateValues");
    await expect(addPortion(ctx, NEW)).rejects.toThrow("updateValues failed");
    expect(fake.calls.filter((call) => call === "ensureColumnCount")).toHaveLength(1);
    expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
  });
});

describe("setPortionActive: switching off", () => {
  /** Chitra (p3) has moved out on 20 September, the month of her last rent; today is 5 October. */
  async function chitraLeft(setup: Setup = {}) {
    const made = await ready(setup);
    await moveOutWithoutDetails(made.ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-09-20" }, { now: OPTIONS.now, updatedBy: "owner@example.com" });
    made.fake.calls.length = 0;
    return made;
  }

  it("switches a vacant portion off with No in its H cell, and Active in H1 when H1 is blank, then reads it back", async () => {
    const { fake, ctx } = await chitraLeft();
    const result = await setPortionActive(ctx, { id: "p3", active: false, today: TODAY });
    expect(fake.tabs.get(SETTINGS_TAB)![0][7]).toBe("Active");
    expect(fake.tabs.get(SETTINGS_TAB)![3][7]).toBe("No");
    expect(result.portions.map((p) => [p.id, p.inactive ?? false])).toEqual([["p1", false], ["p2", false], ["p3", true], ["p4", false], ["p5", false]]);
    expect(wrote(fake)).toEqual(["updateValues"]);
  });

  it("then shows it only in a month where it has an entry, and the month's totals without it", async () => {
    const { ctx } = await chitraLeft();
    await setPortionActive(ctx, { id: "p3", active: false, today: TODAY });
    const oct = await getMonthView(ctx, OCT);
    expect(oct.cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p4", "p5"]);
    expect(oct.due).toBe(5450 + 13335 + 5100);
    const sept = await getMonthView(ctx, { year: 2026, month: 9 });
    expect(sept.cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(sept.cards[2]).toMatchObject({ portionId: "p3", status: "paid", inactive: true });
  });

  it("changes only the Active cells, and leaves every Schedule column and entry as it was", async () => {
    const { fake, ctx } = await chitraLeft();
    const reference = new FakeGateway(Object.fromEntries(fake.tabs));
    await setPortionActive(ctx, { id: "p3", active: false, today: TODAY });
    expect(changedCells(reference, fake, "Schedule")).toEqual([]);
    expect(changedCells(reference, fake, SETTINGS_TAB)).toEqual(["H1", "H4"]);
  });

  it("switches a portion that never had a tenant off", async () => {
    const { ctx } = await ready();
    const result = await setPortionActive(ctx, { id: "p4", active: false, today: TODAY });
    expect(result.portions.find((p) => p.id === "p4")?.inactive).toBe(true);
  });

  it("writes only the portion's cell when the tab already has its Active column", async () => {
    const { fake, ctx } = await ready({ settings: settingsGridWithActive() });
    await setPortionActive(ctx, { id: "p4", active: false, today: TODAY });
    expect(changedCells(new FakeGateway({ [SETTINGS_TAB]: settingsGridWithActive() }), fake, SETTINGS_TAB)).toEqual(["H5"]);
  });

  it("makes its calls in this order: the snapshot, both tabs with FORMULA, the write, the read back, the portions", async () => {
    const { fake, ctx } = await ready();
    await setPortionActive(ctx, { id: "p4", active: false, today: TODAY });
    expect(fake.calls).toEqual(["getManyValues", "getManyValues", "updateValues", "getManyValues", "getValues"]);
  });

  it("is refused for a portion that has a tenant, naming the portion and the tenant, and writes nothing", async () => {
    const { fake, ctx } = await ready();
    const before = snapshotOf(fake);
    const error = await failure(setPortionActive(ctx, { id: "p1", active: false, today: TODAY }));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("First floor, single bedroom still has a tenant (Asha). Record the move-out on the tenant page first.");
    expect(wrote(fake)).toEqual([]);
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("is refused for a portion with an open tenancy, even one with no rent logged yet, naming the tenant on file", async () => {
    const { fake, ctx } = await ready();
    await appendTenancy(fake, {
      id: "t-1", portionId: "p4", tenant: "Dev", phone: "", moveIn: "2026-10-01", agreementEnd: "", advance: null, advanceDate: "", advanceStatus: null,
      refund: null, deductions: null, notes: "", moveOut: "", updatedBy: "owner@example.com", updatedAt: "2026-10-01T05:00:00.000Z",
    });
    fake.calls.length = 0;
    const error = await failure(setPortionActive(ctx, { id: "p4", active: false, today: TODAY }));
    expect(error.message).toBe("Second floor, double bedroom still has a tenant (Dev). Record the move-out on the tenant page first.");
    expect(wrote(fake)).toEqual([]);
  });

  const rent = (ctx: SheetsContext, month: { year: number; month: number }, date: string) =>
    logPayment(ctx, { month, portionId: "p3", amount: 9000, dateReceived: date }, OPTIONS);
  const STAMP = { now: OPTIONS.now, updatedBy: "owner@example.com" };
  const UNPAID = (month: string) => `Second floor, single bedroom has no rent logged for ${month}. Log it before switching the portion off.`;

  it("looks at the month after today's: a move-out on the 1st of next month already leaves it vacant, a later day does not", async () => {
    // today is 5 October, so the month looked at is November; October's rent is logged, as it must be
    const first = await ready();
    await moveOutWithoutDetails(first.ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-11-01" }, STAMP);
    await rent(first.ctx, OCT, "2026-10-05");
    expect((await setPortionActive(first.ctx, { id: "p3", active: false, today: TODAY })).portions.find((p) => p.id === "p3")?.inactive).toBe(true);

    const later = await ready();
    await moveOutWithoutDetails(later.ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-11-02" }, STAMP);
    await rent(later.ctx, OCT, "2026-10-05");
    later.fake.calls.length = 0;
    const error = await failure(setPortionActive(later.ctx, { id: "p3", active: false, today: TODAY }));
    expect(error.message).toContain("still has a tenant (Chitra)");
    expect(wrote(later.fake)).toEqual([]);
  });

  it("moves with today's date: the same move-out is enough a month later, once the months up to then are logged", async () => {
    const { ctx } = await ready();
    await moveOutWithoutDetails(ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-11-02" }, STAMP);
    await rent(ctx, OCT, "2026-10-05");
    await rent(ctx, { year: 2026, month: 11 }, "2026-11-05");
    await expect(setPortionActive(ctx, { id: "p3", active: false, today: "2026-10-31" })).rejects.toBeInstanceOf(AppError);
    expect((await setPortionActive(ctx, { id: "p3", active: false, today: "2026-11-15" })).portions.find((p) => p.id === "p3")?.inactive).toBe(true);
  });

  describe("rent that is still owed", () => {
    it("refuses while this month's rent is not logged, though the move-out is recorded for the end of the month: the card would vanish", async () => {
      // Chitra's move-out is recorded on 5 October for 31 October, and October is unpaid
      const { fake, ctx } = await ready();
      await moveOutWithoutDetails(ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-10-31" }, STAMP);
      fake.calls.length = 0;
      const before = snapshotOf(fake);
      const error = await failure(setPortionActive(ctx, { id: "p3", active: false, today: TODAY }));
      expect(error.code).toBe("conflict");
      expect(error.message).toBe(UNPAID("October 2026"));
      expect(error.message).not.toContain("Chitra");
      expect(wrote(fake)).toEqual([]);
      expect(snapshotOf(fake)).toEqual(before);
      // October still shows what is due
      expect((await getMonthView(ctx, OCT)).due).toBe(5450 + 13335 + 9000 + 5100);
    });

    it("allows it once October is logged, and October's card then stays on the screen as a paid card", async () => {
      const { ctx } = await ready();
      await moveOutWithoutDetails(ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-10-31" }, STAMP);
      await rent(ctx, OCT, "2026-10-05");
      await setPortionActive(ctx, { id: "p3", active: false, today: TODAY });
      const oct = await getMonthView(ctx, OCT);
      expect(oct.cards.find((card) => card.portionId === "p3")).toMatchObject({ status: "paid", inactive: true });
      expect((await getMonthView(ctx, { year: 2026, month: 11 })).cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p4", "p5"]);
    });

    it("refuses while an earlier month is unpaid: a tenant who left in September without paying September", async () => {
      const schedule = baseSchedule();
      schedule[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], null, null, ["Esha", 1, 5100]], 5);
      const { fake, ctx } = await ready({ schedule });
      await moveOutWithoutDetails(ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-09-15" }, STAMP);
      fake.calls.length = 0;
      const error = await failure(setPortionActive(ctx, { id: "p3", active: false, today: TODAY }));
      expect(error.message).toBe(UNPAID("September 2026"));
      expect(wrote(fake)).toEqual([]);
      // the month is owed, so it can be logged; then the portion can be switched off
      await rent(ctx, SEP, "2026-09-15");
      expect((await setPortionActive(ctx, { id: "p3", active: false, today: TODAY })).portions.find((p) => p.id === "p3")?.inactive).toBe(true);
    });

    it("names the earliest unpaid month when there are several", async () => {
      const schedule = baseSchedule();
      schedule[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], null, null, ["Esha", 1, 5100]], 5);
      const { ctx } = await ready({ schedule });
      await moveOutWithoutDetails(ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-10-31" }, STAMP);
      // Chitra paid August and nothing since: September and October are both owed
      expect((await failure(setPortionActive(ctx, { id: "p3", active: false, today: TODAY }))).message).toBe(UNPAID("September 2026"));
    });

    it("does not count a month where the portion was not yet let, or a paid month, as unpaid", async () => {
      // Chitra paid August and September and left on 20 September: nothing is owed
      const { ctx } = await ready();
      await moveOutWithoutDetails(ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-09-20" }, STAMP);
      expect((await setPortionActive(ctx, { id: "p3", active: false, today: TODAY })).portions.find((p) => p.id === "p3")?.inactive).toBe(true);
    });
  });

  it("keeps at least one portion on", async () => {
    const { fake, ctx } = await ready({ settings: settingsGridWithActive({ p1: "No", p2: "No", p3: "No", p5: "No" }) });
    const before = snapshotOf(fake);
    const error = await failure(setPortionActive(ctx, { id: "p4", active: false, today: TODAY }));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("Keep at least one portion switched on.");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("does not look at tenants for a portion that is off already, and writes nothing", async () => {
    const { fake, ctx } = await ready({ settings: settingsGridWithActive({ p1: "No" }) });
    const result = await setPortionActive(ctx, { id: "p1", active: false, today: TODAY });
    expect(wrote(fake)).toEqual([]);
    expect(result.portions.find((p) => p.id === "p1")?.inactive).toBe(true);
  });

  it("refuses when the Tenants tab cannot be read, since a tenant cannot be ruled out, and writes nothing", async () => {
    const { fake, ctx } = await ready();
    fake.tabs.get(TENANTS_TAB)![0][4] = "Moved in";
    const error = await failure(setPortionActive(ctx, { id: "p4", active: false, today: TODAY }));
    expect(error.code).toBe("sheet-structure");
    expect(error.message).toContain('"Move-in date"');
    expect(wrote(fake)).toEqual([]);
  });

  it("refuses a portion it does not know, a date that is not one, and a column H that is not the app's, writing nothing", async () => {
    const { fake, ctx } = await ready();
    expect((await failure(setPortionActive(ctx, { id: "p9", active: false, today: TODAY }))).code).toBe("validation");
    expect((await failure(setPortionActive(ctx, { id: "p4", active: false, today: "yesterday" }))).code).toBe("validation");
    expect(wrote(fake)).toEqual([]);
    const taken = settingsGrid();
    taken[0][7] = "Notes";
    const other = await ready({ settings: taken });
    const error = await failure(setPortionActive(other.ctx, { id: "p4", active: false, today: TODAY }));
    expect(error.message).toContain('Column H of the Settings tab holds "Notes".');
    expect(wrote(other.fake)).toEqual([]);
  });

  it("says it may not have been saved when the flag does not read back", async () => {
    const { fake, ctx } = await ready();
    fake.drop.add(SETTINGS_TAB);
    const error = await failure(setPortionActive(ctx, { id: "p4", active: false, today: TODAY }));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("Second floor, double bedroom may not have been switched off. Check column H of the Settings tab, then try again.");
  });
});

describe("setPortionActive: switching on", () => {
  it("writes Yes in the portion's cell, leaves H1 alone, and the portion is on the month screen again", async () => {
    const { fake, ctx } = await ready({ settings: settingsGridWithActive({ p4: "No" }) });
    const result = await setPortionActive(ctx, { id: "p4", active: true, today: TODAY });
    expect(fake.tabs.get(SETTINGS_TAB)![4][7]).toBe("Yes");
    expect(fake.tabs.get(SETTINGS_TAB)![0][7]).toBe("Active");
    expect(result.portions.some((p) => p.inactive)).toBe(false);
    expect((await getMonthView(ctx, OCT)).cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("brings back a portion with its history: it was on the screen all along while its tenant was there, and loses only the mark", async () => {
    const schedule = baseSchedule();
    schedule[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], ["Dev", 1, 7000], ["Esha", 1, 5100]], 5);
    const { ctx } = await ready({ settings: settingsGridWithActive({ p4: "No" }), schedule });
    const before = await getMonthView(ctx, OCT);
    expect(before.cards.map((card) => [card.portionId, card.status, "inactive" in card])).toEqual([
      ["p1", "pending", false], ["p2", "pending", false], ["p3", "pending", false], ["p4", "pending", true], ["p5", "pending", false],
    ]);
    await setPortionActive(ctx, { id: "p4", active: true, today: TODAY });
    const after = await getMonthView(ctx, OCT);
    expect(after.cards.map((card) => [card.portionId, card.status, "inactive" in card])).toEqual([
      ["p1", "pending", false], ["p2", "pending", false], ["p3", "pending", false], ["p4", "pending", false], ["p5", "pending", false],
    ]);
    expect(after.cards[3].next).toMatchObject({ tenant: "Dev", count: 2 });
    expect(after.due).toBe(before.due);
  });

  it("brings back a vacant portion as a vacant card, and the card of a month it had rent in is as it was", async () => {
    const { ctx } = await ready();
    await moveOutWithoutDetails(ctx, { portionId: "p3", tenant: "Chitra", moveOut: "2026-09-20" }, { now: OPTIONS.now, updatedBy: "owner@example.com" });
    await setPortionActive(ctx, { id: "p3", active: false, today: TODAY });
    expect((await getMonthView(ctx, OCT)).cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p4", "p5"]);
    await setPortionActive(ctx, { id: "p3", active: true, today: TODAY });
    const oct = await getMonthView(ctx, OCT);
    expect(oct.cards.map((card) => [card.portionId, card.status])).toEqual([
      ["p1", "pending"], ["p2", "pending"], ["p3", "vacant"], ["p4", "needs-tenant"], ["p5", "pending"],
    ]);
  });

  it("writes nothing for a portion that is on already, with an Active column or without one", async () => {
    for (const settings of [settingsGridWithActive(), ownerSettings()]) {
      const { fake, ctx } = await ready({ settings });
      const result = await setPortionActive(ctx, { id: "p2", active: true, today: TODAY });
      expect(wrote(fake)).toEqual([]);
      expect(result.portions).toHaveLength(5);
    }
  });

  it("is refused, writing nothing, when the portion's Schedule columns were deleted: every page would stop reading the Sheet", async () => {
    const { fake, ctx } = await ready({ settings: settingsGridWithActive({ p4: "No" }), schedule: scheduleWithoutPortion(baseSchedule(), "p4") });
    const before = snapshotOf(fake);
    const error = await failure(setPortionActive(ctx, { id: "p4", active: true, today: TODAY }));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("can't be switched on");
    expect(snapshotOf(fake)).toEqual(before);
    expect((await getMonthView(ctx, OCT)).cards).toHaveLength(4); // and the app still reads the Sheet
  });
});

describe("reorderPortions", () => {
  const ORDER = ["p3", "p1", "p2", "p4", "p5"];

  it("puts the portions in the new order with one write and reads it back, each portion with its own settings", async () => {
    const { fake, ctx } = await ready({ settings: settingsGridWithActive({ p4: "No" }) });
    const result = await reorderPortions(ctx, { ids: ORDER });
    expect(result.portions.map((p) => p.id)).toEqual(ORDER);
    expect(result.portions.find((p) => p.id === "p4")?.inactive).toBe(true);
    expect(wrote(fake)).toEqual(["updateValues"]);
    expect((await getSettings(ctx)).map((p) => p.id)).toEqual(ORDER);
    expect((await getMonthView(ctx, OCT)).cards.map((card) => card.portionId)).toEqual(["p3", "p1", "p2", "p5"]);
  });

  it("makes its calls in this order: the snapshot, both tabs with FORMULA, the write, the read back, the portions", async () => {
    const { fake, ctx } = await ready();
    await reorderPortions(ctx, { ids: ORDER });
    expect(fake.calls).toEqual(["getManyValues", "getManyValues", "updateValues", "getManyValues", "getValues"]);
  });

  it("never moves a Schedule column: a payment logged afterwards goes where it always did", async () => {
    const { fake, ctx } = await ready();
    const reference = new FakeGateway(Object.fromEntries(fake.tabs));
    await reorderPortions(ctx, { ids: ORDER });
    expect(changedCells(reference, fake, "Schedule")).toEqual([]);
    await logPayment(ctx, { month: OCT, portionId: "p3", amount: 9000, dateReceived: "2026-10-05" }, OPTIONS);
    expect(cell(fake, "Schedule", "H", 6)).toBe("Chitra");
    expect(cell(fake, "Schedule", "J", 6)).toBe(9000);
  });

  it("changes only the Settings rows that change, and keeps the owner's own column H where it is when the tab has no Active column", async () => {
    const settings = ownerSettings();
    settings[1][7] = "a note of the owner's";
    const { fake, ctx } = await ready({ settings });
    const reference = new FakeGateway(Object.fromEntries(fake.tabs));
    await reorderPortions(ctx, { ids: ["p2", "p1", "p3", "p4", "p5"] });
    expect(changedCells(reference, fake, SETTINGS_TAB).every((address) => /^[A-G][23]$/.test(address))).toBe(true);
    expect(fake.tabs.get(SETTINGS_TAB)![1][7]).toBe("a note of the owner's");
    expect((await getSettings(ctx)).map((p) => p.id)).toEqual(["p2", "p1", "p3", "p4", "p5"]);
  });

  it("writes and reads back nothing for an order that has not changed", async () => {
    const { fake, ctx } = await ready();
    const result = await reorderPortions(ctx, { ids: ["p1", "p2", "p3", "p4", "p5"] });
    expect(result.portions.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(fake.calls).toEqual(["getManyValues", "getManyValues"]);
  });

  it("is a conflict, writing nothing, when the ids are not the portions there are", async () => {
    const { fake, ctx } = await ready();
    const before = snapshotOf(fake);
    for (const ids of [["p1", "p2", "p3", "p4"], ["p1", "p2", "p3", "p4", "p5", "p6"], ["p1", "p1", "p2", "p3", "p4"]]) {
      const error = await failure(reorderPortions(ctx, { ids }));
      expect(error.code).toBe("conflict");
      expect(error.message).toBe(STALE_IDS);
    }
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("is a conflict when a portion was added since the page loaded", async () => {
    const { ctx } = await ready();
    const stale = ["p1", "p2", "p3", "p4", "p5"];
    await addPortion(ctx, NEW);
    expect((await failure(reorderPortions(ctx, { ids: stale.reverse() }))).message).toBe(STALE_IDS);
    expect((await reorderPortions(ctx, { ids: ["p6", "p5", "p4", "p3", "p2", "p1"] })).portions.map((p) => p.id)).toEqual(["p6", "p5", "p4", "p3", "p2", "p1"]);
  });

  it("refuses a formula in a row it would move, naming the row, and writes nothing", async () => {
    const settings = settingsGridWithActive();
    settings[2][6] = "=G2";
    const { fake, ctx } = await ready({ settings });
    const before = snapshotOf(fake);
    const error = await failure(reorderPortions(ctx, { ids: ORDER }));
    expect(error.message).toBe("Settings row 3 has a formula in it, which RentBook cannot move. Replace it with its value, then try again.");
    expect(snapshotOf(fake)).toEqual(before);
  });

  it("says the order may not have been saved when a row does not read back as written", async () => {
    const { fake, ctx } = await ready();
    fake.afterWrite = (writes) => {
      if (writes.some((write) => write.tab === SETTINGS_TAB)) fake.tabs.get(SETTINGS_TAB)![2][1] = "Changed under us";
    };
    const error = await failure(reorderPortions(ctx, { ids: ORDER }));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(ORDER_NOT_SAVED);
  });

  it("says the same when the write was dropped", async () => {
    const { fake, ctx } = await ready();
    fake.drop.add(SETTINGS_TAB);
    expect((await failure(reorderPortions(ctx, { ids: ORDER }))).message).toBe(ORDER_NOT_SAVED);
  });
});

describe("the page caches", () => {
  /** A context with the caches on, already holding a month view, a Settings read and the Activity log's turn. */
  async function primed() {
    const made = await ready({ cached: true });
    await getMonthView(made.ctx, OCT);
    await getSettings(made.ctx);
    made.fake.calls.length = 0;
    return made;
  }
  const reads = (fake: FakeGateway) => fake.calls.filter((call) => call === "getValues" || call === "getManyValues").length;

  it("throw away what they held after an add, so the next view shows the new portion", async () => {
    const { ctx } = await primed();
    await addPortion(ctx, NEW);
    expect((await getMonthView(ctx, OCT)).cards).toHaveLength(6);
    expect(await getSettings(ctx)).toHaveLength(6);
  });

  it("throw it away after a switch off, a switch on and a reorder", async () => {
    const { ctx } = await primed();
    await setPortionActive(ctx, { id: "p4", active: false, today: TODAY });
    expect((await getMonthView(ctx, OCT)).cards).toHaveLength(4);
    await setPortionActive(ctx, { id: "p4", active: true, today: TODAY });
    expect((await getMonthView(ctx, OCT)).cards).toHaveLength(5);
    await reorderPortions(ctx, { ids: ["p5", "p4", "p3", "p2", "p1"] });
    expect((await getMonthView(ctx, OCT)).cards.map((card) => card.portionId)).toEqual(["p5", "p4", "p3", "p2", "p1"]);
    expect((await getSettings(ctx)).map((p) => p.id)).toEqual(["p5", "p4", "p3", "p2", "p1"]);
  });

  it("throw it away after a failure too: a refusal, a conflict in the middle, and a failed write", async () => {
    const { fake, ctx } = await primed();
    for (const run of [
      () => addPortion(ctx, { ...NEW, name: "First floor, single bedroom" }),
      () => setPortionActive(ctx, { id: "p1", active: false, today: TODAY }),
      () => reorderPortions(ctx, { ids: ["p1"] }),
    ]) {
      await getMonthView(ctx, OCT); // fill the cache again
      fake.calls.length = 0;
      await failure(run());
      await getMonthView(ctx, OCT);
      expect(reads(fake)).toBeGreaterThan(0);
    }
    // a failure after the first write: the Settings write fails, the headers are in the Sheet, and the next view reads the Sheet again
    await getMonthView(ctx, OCT);
    fake.failWrites.add(SETTINGS_TAB);
    fake.calls.length = 0;
    await expect(addPortion(ctx, NEW)).rejects.toThrow("Google said no");
    fake.calls.length = 0;
    await getMonthView(ctx, OCT);
    expect(reads(fake)).toBeGreaterThan(0);
  });
});

describe("the write lock, and the owner's current behaviour", () => {
  it("runs a service after the write ahead of it: a payment being logged finishes before the add starts", async () => {
    const { fake, ctx } = await ready();
    fake.delayMs = 1;
    const log = logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    const add = addPortion(ctx, NEW);
    await Promise.all([log, add]);
    // the log cloned October's row first; the add then read a Schedule that has it, and still found the columns right of the total
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
    expect(cell(fake, "Schedule", "T", 3)).toBe("Amount6");
    expect(cell(fake, "Schedule", "R", 6)).toBeUndefined();
  });

  it("changes nothing of the owner's Settings tab but the cells it writes: the seven headers stay seven until a portion is switched off", async () => {
    const { fake, ctx } = await ready();
    await addPortion(ctx, NEW);
    expect(fake.tabs.get(SETTINGS_TAB)![0]).toHaveLength(7);
    await reorderPortions(ctx, { ids: ["p6", "p1", "p2", "p3", "p4", "p5"] });
    expect(fake.tabs.get(SETTINGS_TAB)![0]).toHaveLength(7);
  });
});

describe("saving the settings of a portion beside a reorder", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const ORDER = ["p3", "p1", "p2", "p4", "p5"];

  /** Whatever the interleaving, each id ends with its own row: p1 renamed with its new cycle and hike, the others untouched, in the new order. */
  async function expectConsistent(fake: FakeGateway, ctx: SheetsContext) {
    const portions = await getSettings(ctx);
    expect(portions.map((p) => p.id)).toEqual(ORDER);
    expect(portions.map((p) => [p.id, p.name, p.cycleLength, p.hikePercent])).toEqual([
      ["p3", "Second floor, single bedroom", 11, 5],
      ["p1", "Renamed", 12, 6],
      ["p2", "First floor, double bedroom", 11, 5],
      ["p4", "Second floor, double bedroom", 11, 5],
      ["p5", "Third floor, hall and kitchen", 11, 5],
    ]);
    expect(fake.tabs.get(SETTINGS_TAB)!.slice(1, 6).map((row) => row[2])).toEqual(["Tenant3", "Tenant", "Tenant2", "Tenant4", "Tenant5"]);
  }

  it.each([0, 1, 2, 3, 4, 5, 6, 8, 10, 12])("keeps every id with its own row when the save starts %i ms after the reorder", async (offset) => {
    const { fake, ctx } = await ready();
    fake.delayMs = 1;
    const reorder = reorderPortions(ctx, { ids: ORDER });
    await sleep(offset);
    const save = saveSettings(ctx, [{ id: "p1", name: "Renamed", cycleLength: 12, hikePercent: 6 }]);
    await Promise.all([reorder, save]);
    fake.delayMs = 0;
    await expectConsistent(fake, ctx);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 8, 10, 12])("and when the reorder starts %i ms after the save", async (offset) => {
    const { fake, ctx } = await ready();
    fake.delayMs = 1;
    const save = saveSettings(ctx, [{ id: "p1", name: "Renamed", cycleLength: 12, hikePercent: 6 }]);
    await sleep(offset);
    const reorder = reorderPortions(ctx, { ids: ORDER });
    await Promise.all([reorder, save]);
    fake.delayMs = 0;
    await expectConsistent(fake, ctx);
  });

  it("runs after the write ahead of it, and throws the caches away when it fails too", async () => {
    const { fake, ctx } = await ready({ cached: true });
    await getSettings(ctx);
    await expect(saveSettings(ctx, [{ id: "p9", name: "Nobody", cycleLength: 11, hikePercent: 5 }])).rejects.toBeInstanceOf(AppError);
    fake.calls.length = 0;
    await getSettings(ctx);
    expect(fake.calls.length).toBeGreaterThan(0);
  });
});
