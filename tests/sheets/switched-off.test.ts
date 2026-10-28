import { describe, expect, it } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";
import { getMonthView, loadSnapshot, logPayment, undoPayment, type SheetsContext } from "@/lib/sheets/service";
import { activeCellsToFix, ensureTabs, readSettings, SETTINGS_HEADERS, SETTINGS_RANGE, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { getPortionTenants, moveOutWithoutDetails, saveTenancy } from "@/lib/sheets/tenancy-service";
import { cell, FakeGateway } from "../support/fake-gateway";
import {
  baseSchedule,
  monthCell,
  PORTIONS,
  scheduleRow,
  scheduleWithoutPortion,
  seededSettingsGrid,
  settingsGrid,
  settingsGridWithActive,
  TOTAL_HEADER,
} from "../support/fixtures";

const OCT = { year: 2026, month: 10 };
const SEP = { year: 2026, month: 9 };
const NOV = { year: 2026, month: 11 };
const OPTIONS = { now: new Date("2026-10-05T04:30:00Z"), retryDelayMs: 0, loggedBy: "owner@example.com" };
const STAMP = { now: OPTIONS.now, updatedBy: "owner@example.com" };

/** The owner's Settings tab as it is today: the seven headers A to G, and H1 blank. (The fixture's own header row has the eighth, Active.) */
const ownerSettings = settingsGrid;

function sheet(settings: unknown[][] = ownerSettings(), schedule: unknown[][] = baseSchedule()) {
  const fake = new FakeGateway({ Schedule: schedule, [SETTINGS_TAB]: settings });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

/** What a card shows, as the month screen needs it: id, status, the tenant and count it carries, and the rent it is measured against. */
const summary = (cards: PortionCard[]) =>
  cards.map((card) => [card.portionId, card.status, card.entry?.tenant ?? card.next?.tenant ?? null, card.entry?.count ?? card.next?.count ?? null, card.rentReference]);

describe("pins: a Settings tab with no Active column (the owner's, columns A to G, H1 blank)", () => {
  it("shows the same cards, due and received in October 2026 as it always has (numbers written out by hand)", async () => {
    const { ctx } = sheet();
    const view = await getMonthView(ctx, OCT);
    expect(summary(view.cards)).toEqual([
      ["p1", "pending", "Asha", 4, 5450],
      ["p2", "pending", "Bala", 1, 13335],
      ["p3", "pending", "Chitra", 6, 9000],
      ["p4", "needs-tenant", null, null, null],
      ["p5", "pending", "Esha", 2, 5100],
    ]);
    expect(view.received).toBe(0);
    expect(view.due).toBe(32885);
    expect(view.paidCount).toBe(0);
  });

  it("shows the same cards, due and received in September 2026", async () => {
    const { ctx } = sheet();
    const view = await getMonthView(ctx, SEP);
    expect(summary(view.cards)).toEqual([
      ["p1", "paid", "Asha", 3, 5450],
      ["p2", "paid", "Bala", 11, 12700],
      ["p3", "paid", "Chitra", 5, 9000],
      ["p4", "needs-tenant", null, null, null],
      ["p5", "paid", "Esha", 1, null],
    ]);
    expect(view.received).toBe(32250);
    expect(view.due).toBe(32250);
  });

  it("leaves every portion on when a blank H1 has No under it (the column is not read until H1 says Active)", async () => {
    const grid = ownerSettings();
    expect(grid[0]).toHaveLength(7);
    grid[2][7] = "No"; // row 3 is p2
    grid[4][7] = "off"; // row 5 is p4
    const { ctx, fake } = sheet(grid);
    const portions = await readSettings(fake);
    expect(portions).toEqual(PORTIONS);
    expect(portions.some((portion) => "inactive" in portion)).toBe(false);
    const view = await getMonthView(ctx, OCT);
    expect(summary(view.cards).map((row) => row.slice(0, 2))).toEqual([
      ["p1", "pending"],
      ["p2", "pending"],
      ["p3", "pending"],
      ["p4", "needs-tenant"],
      ["p5", "pending"],
    ]);
    expect(view.due).toBe(32885);
  });

  it("leaves every portion on when H1 holds other text, whatever the cells under it say", async () => {
    const grid = ownerSettings();
    grid[0][7] = "Notes";
    grid[2][7] = "No";
    const { fake } = sheet(grid);
    expect(await readSettings(fake)).toEqual(PORTIONS);
  });

  it("keeps the snapshot of the fixture Sheet as it was: five portions, two months, every portion with columns", async () => {
    const { ctx } = sheet();
    const snapshot = await loadSnapshot(ctx);
    expect(snapshot.portions).toEqual(PORTIONS);
    expect(snapshot.rows).toHaveLength(2);
    expect([...snapshot.layout.portionCols.keys()]).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
});

const off = (id: string) => PORTIONS.map((portion) => (portion.id === id ? { ...portion, inactive: true } : portion));

describe("the Active column", () => {
  it("is the eighth Settings header, and the Settings range reads to column H", () => {
    expect(SETTINGS_HEADERS).toHaveLength(8);
    expect(SETTINGS_HEADERS[7]).toBe("Active");
    expect(SETTINGS_RANGE).toBe("A1:H50");
  });

  it.each([["No"], ["no "], ["NO"], ["Inactive"], ["off"], [" Off "], [false], ["false"], ["No\u00a0"]])(
    "reads %j under an Active header as switched off",
    async (flag) => {
      const { fake } = sheet(settingsGridWithActive({ p2: flag }));
      expect(await readSettings(fake)).toEqual(off("p2"));
    },
  );

  it.each([[""], [undefined], ["Yes"], ["Active"], ["on"], [true], ["true"], ["maybe"], [0]])(
    "reads %j under an Active header as on, with no inactive field at all",
    async (flag) => {
      const { fake } = sheet(settingsGridWithActive({ p2: flag }));
      const portions = await readSettings(fake);
      expect(portions).toEqual(PORTIONS);
      expect(portions.every((portion) => !("inactive" in portion))).toBe(true);
    },
  );

  it.each([["ACTIVE"], [" Active "], ["active\u00a0"], ["Act\u200bive"], ["Ａctive"]])(
    "finds the header %j by the looser header rule",
    async (header) => {
      const grid = settingsGridWithActive({ p3: "No" });
      grid[0][7] = header;
      const { fake } = sheet(grid);
      expect(await readSettings(fake)).toEqual(off("p3"));
    },
  );

  it("switches off any number of portions, and the loaded snapshot carries the flag", async () => {
    const { ctx } = sheet(settingsGridWithActive({ p1: "No", p4: "off" }));
    const snapshot = await loadSnapshot(ctx);
    expect(snapshot.portions.filter((portion) => portion.inactive).map((portion) => portion.id)).toEqual(["p1", "p4"]);
  });

  it("is seeded blank: the eight headers, no cell under Active, every portion on", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    const grid = fake.tabs.get(SETTINGS_TAB)!;
    expect(grid[0]).toEqual(SETTINGS_HEADERS);
    expect(grid.slice(1).every((row) => row.length === 7)).toBe(true);
    expect(grid).toEqual(seededSettingsGrid());
    expect(await readSettings(fake)).toEqual(PORTIONS);
  });
});

describe("the month screen with a portion switched off", () => {
  /** Dev is in p4 in August and September (payments 1 and 2); October has no entry for p4, and no move-out is on file. */
  function withHistory() {
    const schedule = baseSchedule();
    schedule[3] = scheduleRow(monthCell("text", 2026, 8), [["Asha", 2, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000], ["Dev", 1, 7000], null], 4);
    schedule[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], ["Dev", 2, 7000], ["Esha", 1, 5100]], 5);
    return sheet(settingsGridWithActive({ p4: "No" }), schedule);
  }

  it("shows the portion in a month where it has an entry, as a paid card marked switched off", async () => {
    const { ctx } = withHistory();
    const sept = await getMonthView(ctx, SEP);
    expect(sept.cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(sept.cards[3]).toMatchObject({ portionId: "p4", status: "paid", inactive: true, entry: { tenant: "Dev", count: 2, amount: 7000 } });
    expect(sept.received).toBe(32250 + 7000);
    expect(sept.paidCount).toBe(5);
  });

  it("keeps its card in the months after, while its tenant is still the tenant in the Schedule: switching it off never hides rent", async () => {
    const { ctx } = withHistory();
    for (const month of [OCT, NOV]) {
      const view = await getMonthView(ctx, month);
      expect(view.cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
      expect(view.cards[3]).toMatchObject({ portionId: "p4", status: "pending", inactive: true, next: { tenant: "Dev", count: 3 } });
    }
    expect((await getMonthView(ctx, OCT)).due).toBe(5450 + 13335 + 9000 + 7000 + 5100);
  });

  it("has no card for it from the month it is vacant, and still has the earlier months", async () => {
    const { ctx } = withHistory();
    await moveOutWithoutDetails(ctx, { portionId: "p4", tenant: "Dev", moveOut: "2026-09-30" }, STAMP);
    const oct = await getMonthView(ctx, OCT);
    expect(oct.cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p5"]);
    expect(oct.due).toBe(5450 + 13335 + 9000 + 5100);
    expect((await getMonthView(ctx, NOV)).cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p5"]);
    expect((await getMonthView(ctx, SEP)).cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("has no card for a switched-off portion that never had a tenant", async () => {
    const { ctx } = sheet(settingsGridWithActive({ p4: "No" }));
    expect((await getMonthView(ctx, OCT)).cards.map((card) => card.portionId)).toEqual(["p1", "p2", "p3", "p5"]);
  });

  it("marks only the switched-off portion's card", async () => {
    const { ctx } = withHistory();
    const sept = await getMonthView(ctx, SEP);
    expect(sept.cards.filter((card) => "inactive" in card).map((card) => card.portionId)).toEqual(["p4"]);
  });

  it("gives the same cards as before, in every month, when no portion is switched off", async () => {
    const { ctx } = sheet(settingsGridWithActive());
    const view = await getMonthView(ctx, OCT);
    expect(summary(view.cards).map((row) => row[0])).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(view.due).toBe(32885);
  });
});

describe("logging a payment for a portion that is switched off", () => {
  const REFUSAL = "Second floor, double bedroom is switched off in Portion settings. Switch it back on to log rent for it.";
  const history = () => {
    const schedule = baseSchedule();
    schedule[3] = scheduleRow(monthCell("text", 2026, 8), [["Asha", 2, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000], ["Dev", 1, 7000], null], 4);
    schedule[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], ["Dev", 2, 7000], ["Esha", 1, 5100]], 5);
    return schedule;
  };
  const PAY = { month: OCT, portionId: "p4", amount: 7000, dateReceived: "2026-10-05" };

  /** The Sheet after its first read, so the calls and the writes that follow are the request's own (the first read adds the app's tabs). */
  async function warm(...args: Parameters<typeof sheet>) {
    const made = sheet(...args);
    await loadSnapshot(made.ctx);
    made.fake.calls.length = 0;
    return made;
  }

  async function refusal(promise: Promise<unknown>) {
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }

  /** Dev has moved out of p4 (on 30 September), so October is vacant: the portion is genuinely off. */
  async function devLeft() {
    const made = sheet(settingsGridWithActive({ p4: "No" }), history());
    await moveOutWithoutDetails(made.ctx, { portionId: "p4", tenant: "Dev", moveOut: "2026-09-30" }, STAMP);
    await loadSnapshot(made.ctx);
    made.fake.calls.length = 0;
    return made;
  }

  it("refuses a plain log for a month the portion is vacant in, with its name, and writes nothing", async () => {
    const { ctx, fake } = await devLeft();
    const before = structuredClone([...fake.tabs]);
    const error = await refusal(logPayment(ctx, PAY, OPTIONS));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(REFUSAL);
    expect(fake.calls).not.toContain("updateValues");
    expect(fake.calls).not.toContain("cloneRow");
    expect(fake.calls).not.toContain("appendRow");
    expect(structuredClone([...fake.tabs])).toEqual(before);
  });

  it("refuses a plain log for a switched-off portion that never had a tenant", async () => {
    const { ctx } = sheet(settingsGridWithActive({ p4: "No" }));
    expect((await refusal(logPayment(ctx, { ...PAY, month: SEP }, OPTIONS))).message).toBe(REFUSAL);
  });

  it("takes a plain log for a month whose tenant is still there: the rent is owed, the card is on the screen, and it is logged", async () => {
    const { ctx, fake } = await warm(settingsGridWithActive({ p4: "No" }), history());
    const result = await logPayment(ctx, PAY, OPTIONS);
    expect(result.entry).toEqual({ tenant: "Dev", count: 3, amount: 7000 });
    expect(result.logRow[8]).toBe("Logged");
    expect(cell(fake, "Schedule", "M", 6)).toBe(7000);
    expect((await getMonthView(ctx, OCT)).cards[3]).toMatchObject({ portionId: "p4", status: "paid", inactive: true });
  });

  it("refuses a New tenant for it, whether the tenant is still there or not, and writes nothing", async () => {
    const { ctx, fake } = await warm(settingsGridWithActive({ p4: "No" }), history());
    const error = await refusal(logPayment(ctx, { ...PAY, newTenantName: "Hari" }, OPTIONS));
    expect(error.message).toBe(REFUSAL);
    expect(fake.calls).not.toContain("updateValues");
    const gone = await devLeft();
    expect((await refusal(logPayment(gone.ctx, { ...PAY, newTenantName: "Hari" }, OPTIONS))).message).toBe(REFUSAL);
  });

  it("still edits an entry it has, and says so in the log", async () => {
    const { ctx, fake } = sheet(settingsGridWithActive({ p4: "No" }), history());
    const result = await logPayment(
      ctx,
      { month: SEP, portionId: "p4", amount: 7100, dateReceived: "2026-09-06", overwrite: true, expected: { tenant: "Dev", count: 2, amount: 7000 } },
      OPTIONS,
    );
    expect(result.entry).toEqual({ tenant: "Dev", count: 2, amount: 7100 });
    expect(cell(fake, "Schedule", "M", 5)).toBe(7100);
    expect(result.logRow[8]).toBe("Edited");
  });

  it("still undoes its latest entry", async () => {
    const { ctx, fake } = sheet(settingsGridWithActive({ p4: "No" }), history());
    const result = await undoPayment(ctx, { month: SEP, portionId: "p4", expected: { tenant: "Dev", count: 2, amount: 7000 } }, OPTIONS);
    expect(result.removed).toEqual({ tenant: "Dev", count: 2, amount: 7000 });
    expect(cell(fake, "Schedule", "M", 5)).toBe("");
  });

  it("logs the other portions, and adds a month, with the switched-off portion's columns deleted", async () => {
    const schedule = scheduleWithoutPortion(baseSchedule(), "p4");
    const { ctx, fake } = sheet(settingsGridWithActive({ p4: "No" }), schedule);
    // October is a new month: the row is cloned from September, which has the formula total, then p1's cells are written.
    const result = await logPayment(ctx, { ...PAY, portionId: "p1", amount: 5450 }, OPTIONS);
    expect(result.entry).toEqual({ tenant: "Asha", count: 4, amount: 5450 });
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(cell(fake, "Schedule", "N", 6)).toBe("=D6+G6+J6+M6");
    // p5 sits where p4 was (columns K to M): its cells were cleared by the clone, not carried from September.
    expect(cell(fake, "Schedule", "L", 6)).toBeUndefined();
    const view = await getMonthView(ctx, OCT);
    expect(view.cards.map((card) => [card.portionId, card.status])).toEqual([
      ["p1", "paid"],
      ["p2", "pending"],
      ["p3", "pending"],
      ["p5", "pending"],
    ]);
    expect(view.due).toBe(5450 + 13335 + 9000 + 5100);
    // and a second log, for another portion, in that month
    await logPayment(ctx, { ...PAY, portionId: "p5", amount: 5100 }, OPTIONS);
    expect(cell(fake, "Schedule", "M", 6)).toBe(5100);
  });

  it("still writes a typed total, adding up only the portions that have columns", async () => {
    const schedule = scheduleWithoutPortion(baseSchedule(), "p4");
    schedule[3][13] = 32150;
    schedule[4][13] = 32250;
    const { ctx, fake } = sheet(settingsGridWithActive({ p4: "No" }), schedule);
    await logPayment(ctx, { ...PAY, month: SEP, portionId: "p1", amount: 5500, overwrite: true, expected: { tenant: "Asha", count: 3, amount: 5450 } }, OPTIONS);
    expect(cell(fake, "Schedule", "N", 5)).toBe(5500 + 12700 + 9000 + 5100);
  });
});

describe("the tenant page's data for a portion that is switched off", () => {
  it("is there, with the portion marked off, whether or not its Schedule columns are still there", async () => {
    const kept = sheet(settingsGridWithActive({ p4: "No" }));
    const keptData = await getPortionTenants(kept.ctx, "p4");
    expect(keptData.portion).toMatchObject({ id: "p4", inactive: true });
    expect(keptData.scheduleTenant).toBeNull();

    const deleted = sheet(settingsGridWithActive({ p4: "No" }), scheduleWithoutPortion(baseSchedule(), "p4"));
    const deletedData = await getPortionTenants(deleted.ctx, "p4");
    expect(deletedData.portion).toMatchObject({ id: "p4", inactive: true });
    expect(deletedData.scheduleTenant).toBeNull();
    expect(deletedData.past).toEqual([]);
    // the portions that are on are unchanged
    expect((await getPortionTenants(deleted.ctx, "p1")).scheduleTenant).toBe("Asha");
  });
});

describe("tenant details for a portion that is switched off", () => {
  const FIELDS = { phone: "98765 43210", moveIn: "2026-01-15", agreementEnd: "", advance: null, advanceDate: "", notes: "" };
  const history = () => {
    const schedule = baseSchedule();
    schedule[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], ["Dev", 2, 7000], ["Esha", 1, 5100]], 5);
    return schedule;
  };

  async function warm(settings: unknown[][]) {
    const made = sheet(settings, history());
    await loadSnapshot(made.ctx);
    made.fake.calls.length = 0;
    return made;
  }

  it("refuses Add details for the Schedule's last tenant: it would open a tenancy on a portion that is hidden, and writes nothing", async () => {
    const { ctx, fake } = await warm(settingsGridWithActive({ p4: "No" }));
    const error = await saveTenancy(ctx, { portionId: "p4", tenant: "Dev", fields: FIELDS }, STAMP).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("validation");
    expect((error as AppError).message).toBe("Second floor, double bedroom is switched off in Portion settings. Switch the portion on first.");
    expect(fake.calls).not.toContain("appendRow");
    expect(fake.calls).not.toContain("updateValues");
  });

  it("takes them once the portion is switched on", async () => {
    const { ctx } = await warm(settingsGridWithActive());
    expect((await saveTenancy(ctx, { portionId: "p4", tenant: "Dev", fields: FIELDS }, STAMP)).tenancy.tenant).toBe("Dev");
  });

  it("still records that the tenant moved out", async () => {
    const { ctx } = await warm(settingsGridWithActive({ p4: "No" }));
    await moveOutWithoutDetails(ctx, { portionId: "p4", tenant: "Dev", moveOut: "2026-09-30" }, STAMP);
    expect((await getPortionTenants(ctx, "p4")).vacantSince).toBe("2026-09-30");
  });
});

describe("Active cells that are not Yes or No", () => {
  it.each([["x"], ["N"], ["0"], ["No."], ["nope"], ["disabled"], [0], [5]])(
    "read %j as on, as before, and are named for the Set up page to warn about",
    async (value) => {
      const grid = settingsGridWithActive({ p3: value });
      const { fake } = sheet(grid);
      expect(await readSettings(fake)).toEqual(PORTIONS);
      expect(activeCellsToFix(grid)).toEqual([4]);
    },
  );

  it("names every such cell, as the Settings row it is on, and none that is empty or a flag", () => {
    const grid = settingsGridWithActive({ p1: "Yes", p2: "No", p3: "maybe", p4: false, p5: "x" });
    expect(activeCellsToFix(grid)).toEqual([4, 6]);
    expect(activeCellsToFix(settingsGridWithActive({ p1: "on", p2: "OFF", p3: "inactive", p4: true, p5: "" }))).toEqual([]);
    expect(activeCellsToFix(settingsGridWithActive())).toEqual([]);
  });

  it("counts a cell of spaces, which the app would not write over", () => {
    expect(activeCellsToFix(settingsGridWithActive({ p2: "  " }))).toEqual([3]);
  });

  it("names none when H1 is not Active: the column is not the app's then", () => {
    const grid = settingsGrid();
    grid[2][7] = "x";
    expect(activeCellsToFix(grid)).toEqual([]);
    grid[0][7] = "Notes";
    expect(activeCellsToFix(grid)).toEqual([]);
  });

  it("does not count a note row under the table", () => {
    const grid = settingsGridWithActive();
    grid[7] = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, "a note in column H"];
    expect(activeCellsToFix(grid)).toEqual([]);
  });
});
