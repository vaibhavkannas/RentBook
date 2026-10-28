import { describe, expect, it } from "vitest";
import type { PortionConfig } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";
import { colLetter } from "@/lib/sheets/a1";
import type { CellWrite } from "@/lib/sheets/gateway";
import {
  checkNewPortion,
  planAddPortion,
  planReorder,
  planSetActive,
  planTotalNote,
  type AddPlan,
  type PlanInput,
} from "@/lib/sheets/portion-plan";
import { getMonthView, loadSnapshot, type SheetsContext } from "@/lib/sheets/service";
import { readSettings, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { FakeGateway } from "../support/fake-gateway";
import { changedCells, expectOnlyPlanned } from "../support/grid-diff";
import {
  baseSchedule,
  monthCell,
  PORTIONS,
  scheduleRow,
  seededSettingsGrid,
  settingsGrid,
  settingsGridWithActive,
  TOTAL_HEADER,
} from "../support/fixtures";

// The planners decide which cells change when a portion is added, switched off or on, or moved. They are pure: what they
// are given is what the Sheet held (the Schedule's A1:ZZ and Settings' A1:Z50 read with FORMULA, and the portions the Settings
// tab parsed to), and what they give back is every cell to write. These tests read the fixture Sheet that way, apply a plan
// to a copy of it, and look at the copy: through the app's own reader, and cell by cell.

const OCT = { year: 2026, month: 10 };
const CHANGED = "Your portions changed since this page loaded. Tap another tab at the bottom of the screen and come back, then try again.";

function world(settings: unknown[][] = settingsGrid(), schedule: unknown[][] = baseSchedule()) {
  return new FakeGateway({ Schedule: schedule, [SETTINGS_TAB]: settings });
}

/** What the services hand the planners: both tabs read with the FORMULA render, and the portions the Settings parse to. */
async function inputFor(fake: FakeGateway, extra: Partial<PlanInput> = {}): Promise<PlanInput> {
  const portions = await readSettings(fake);
  const [schedule, settings] = await fake.getManyValues(
    [
      { tab: "Schedule", a1: "A1:ZZ" },
      { tab: SETTINGS_TAB, a1: "A1:Z50" },
    ],
    "FORMULA",
  );
  return { scheduleTab: "Schedule", schedule, settings, portions, ...extra };
}

/** A copy of the Sheet with `writes` applied, as the gateway would apply them. */
async function applied(fake: FakeGateway, writes: CellWrite[]): Promise<FakeGateway> {
  const copy = new FakeGateway(Object.fromEntries([...fake.tabs]));
  await copy.updateValues(writes);
  return copy;
}

const ctxOf = (fake: FakeGateway): SheetsContext => ({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });

/** What a planner refuses with: `run` may be async (it reads the Sheet first), and it must refuse. */
async function refusal(run: () => unknown): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

/** The same for a refusal that needs no read (a planner that checks its request first), so a test can stay synchronous. */
function refusalNow(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

const NEW = { name: "Back room", cycleLength: 11, hikePercent: 5 };

/** The Schedule with `cells` put into the grid: `[row (1-based), column (0-based), value]`. */
function withCells(cells: [number, number, unknown][], schedule: unknown[][] = baseSchedule()) {
  for (const [row, col, value] of cells) {
    while (schedule.length < row) schedule.push([]);
    schedule[row - 1][col] = value;
  }
  return schedule;
}

const headerTriple = (n: number | string, space = "") => [`Tenant${space}${n}`, `Count${space}${n}`, `Amount${space}${n}`];

describe("checkNewPortion", () => {
  it("trims the name and keeps the numbers", () => {
    expect(checkNewPortion({ name: "  Back room  ", cycleLength: 11, hikePercent: 5 })).toEqual({ name: "Back room", cycleLength: 11, hikePercent: 5 });
    expect(checkNewPortion({ name: "Shop", cycleLength: null, hikePercent: 0 })).toEqual({ name: "Shop", cycleLength: null, hikePercent: 0 });
  });

  it.each([["", "name"], ["   ", "name"], ["x".repeat(61), "name"]])("refuses the name %j with the same sentence as any name", (name, field) => {
    const error = refusalNow(() => checkNewPortion({ ...NEW, name }));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("Portion name must be 1 to 60 characters.");
    expect(error.details).toEqual({ field });
  });

  it("accepts 60 characters and refuses a line break", () => {
    expect(checkNewPortion({ ...NEW, name: "x".repeat(60) }).name).toHaveLength(60);
    expect(() => checkNewPortion({ ...NEW, name: "Back\nroom" })).toThrow("Portion name cannot have line breaks or other control characters.");
  });

  it.each([[0], [121], [1.5], [-3], [Number.NaN]])("refuses %s payments per cycle with updateSettings' own sentence", (cycleLength) => {
    const error = refusalNow(() => checkNewPortion({ ...NEW, cycleLength }));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("Payments per cycle must be a whole number from 1 to 120.");
    expect(error.details).toEqual({ field: "cycleLength" });
  });

  it.each([[1], [120], [null]])("accepts %s payments per cycle", (cycleLength) => {
    expect(checkNewPortion({ ...NEW, cycleLength }).cycleLength).toBe(cycleLength);
  });

  it.each([[-1], [100.5], [Number.NaN], [Number.POSITIVE_INFINITY]])("refuses a hike of %s with updateSettings' own sentence", (hikePercent) => {
    const error = refusalNow(() => checkNewPortion({ ...NEW, hikePercent }));
    expect(error.message).toBe("Hike must be a number from 0 to 100.");
    expect(error.details).toEqual({ field: "hikePercent" });
  });

  it.each([[0], [100], [7.5]])("accepts a hike of %s", (hikePercent) => {
    expect(checkNewPortion({ ...NEW, hikePercent }).hikePercent).toBe(hikePercent);
  });
});

describe("planAddPortion: the owner's Sheet", () => {
  it("adds Tenant6, Count6 and Amount6 to the right of the Total column, and a row under the last portion", async () => {
    const fake = world();
    const plan = planAddPortion(await inputFor(fake), NEW);
    expect(plan).toEqual({
      id: "p6",
      headers: ["Tenant6", "Count6", "Amount6"],
      columns: [17, 18, 19],
      adopted: false,
      minColumns: 20,
      headerRow: 3,
      settingsRow: 7,
      scheduleWrites: [{ tab: "Schedule", a1: "R3:T3", values: [["Tenant6", "Count6", "Amount6"]] }],
      settingsWrites: [{ tab: SETTINGS_TAB, a1: "A7:G7", values: [["p6", "Back room", "Tenant6", "Count6", "Amount6", 11, 5]] }],
    } satisfies AddPlan);
  });

  it("changes exactly those cells, and the app then reads the new portion last, with no entries and every old portion as it was", async () => {
    const fake = world();
    const before = await loadSnapshot(ctxOf(world()));
    const plan = planAddPortion(await inputFor(fake), NEW);
    const after = await applied(fake, [...plan.scheduleWrites, ...plan.settingsWrites]);

    expectOnlyPlanned(fake, after, [...plan.scheduleWrites, ...plan.settingsWrites]);
    expect(changedCells(fake, after, "Schedule")).toEqual(["R3", "S3", "T3"]);
    expect(changedCells(fake, after, SETTINGS_TAB)).toEqual(["A7", "B7", "C7", "D7", "E7", "F7", "G7"]);

    const snapshot = await loadSnapshot(ctxOf(after));
    expect(snapshot.portions.map((portion) => portion.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(snapshot.portions[5]).toEqual({
      id: "p6",
      name: "Back room",
      tenantHeader: "Tenant6",
      countHeader: "Count6",
      amountHeader: "Amount6",
      cycleLength: 11,
      hikePercent: 5,
    });
    expect(snapshot.layout.portionCols.get("p6")).toEqual({ tenant: 17, count: 18, amount: 19 });
    for (const portion of PORTIONS) {
      expect(snapshot.layout.portionCols.get(portion.id)).toEqual(before.layout.portionCols.get(portion.id));
    }
    expect(snapshot.layout.totalCol).toBe(before.layout.totalCol);
    expect(snapshot.layout.lastDataRow).toBe(before.layout.lastDataRow);
    expect(snapshot.rows.map((row) => [row.rowNumber, row.month])).toEqual(before.rows.map((row) => [row.rowNumber, row.month]));
    for (const [index, row] of snapshot.rows.entries()) {
      for (const portion of PORTIONS) expect(row.entries.get(portion.id)).toEqual(before.rows[index].entries.get(portion.id));
      expect(row.entries.get("p6")).toBeNull();
    }
  });

  it("shows the new portion as a card that needs a tenant, adding nothing to what is due", async () => {
    const fake = world();
    const plan = planAddPortion(await inputFor(fake), NEW);
    const after = await applied(fake, [...plan.scheduleWrites, ...plan.settingsWrites]);
    const view = await getMonthView(ctxOf(after), OCT);
    expect(view.cards).toHaveLength(6);
    expect(view.cards[5]).toMatchObject({ portionId: "p6", name: "Back room", status: "needs-tenant", next: null });
    expect(view.due).toBe((await getMonthView(ctxOf(world()), OCT)).due);
  });

  it("writes a blank cycle length for a portion whose count never resets", async () => {
    const plan = planAddPortion(await inputFor(world()), { ...NEW, cycleLength: null, hikePercent: 0 });
    expect(plan.settingsWrites[0].values).toEqual([["p6", "Back room", "Tenant6", "Count6", "Amount6", "", 0]]);
  });

  it("leaves the Active cell blank, so the portion is on, whether or not the Settings tab has an Active column", async () => {
    for (const settings of [seededSettingsGrid(), settingsGrid()]) {
      const plan = planAddPortion(await inputFor(world(settings)), NEW);
      expect(plan.settingsWrites[0].a1).toBe("A7:G7");
      const after = await applied(world(settings), plan.settingsWrites);
      expect(after.tabs.get(SETTINGS_TAB)![6][7]).toBeUndefined();
    }
  });

  it("works from the Schedule's own header row wherever it is: row 1 has its three cells in row 1", async () => {
    const schedule = baseSchedule().slice(2); // the header is now row 1
    const plan = planAddPortion(await inputFor(world(settingsGrid(), schedule)), NEW);
    expect(plan.headerRow).toBe(1);
    expect(plan.scheduleWrites[0].a1).toBe("R1:T1");
  });

  it("is refused when the Schedule has no header row, in the words the rest of the app uses", async () => {
    const input = await inputFor(world(settingsGrid(), [["nothing here"], ["Aug-26"]]));
    const error = await refusal(() => planAddPortion(input, NEW));
    expect(error.code).toBe("sheet-structure");
    expect(error.message).toBe('No header row containing "Month" was found in the Schedule tab.');
  });
});

describe("planAddPortion: the name, and how many portions", () => {
  it("refuses a name another portion has, ignoring case and spaces, switched off or not", async () => {
    const input = await inputFor(world());
    for (const name of ["first floor, single bedroom", "  FIRST FLOOR,  SINGLE BEDROOM "]) {
      const error = await refusal(() => planAddPortion(input, { ...NEW, name }));
      expect(error.code).toBe("validation");
      expect(error.message).toBe('There is already a portion called "First floor, single bedroom". Choose a different name.');
      expect(error.details).toEqual({ field: "name" });
    }
    const off = await inputFor(world(settingsGridWithActive({ p3: "No" })));
    expect((await refusal(() => planAddPortion(off, { ...NEW, name: "second floor, single bedroom" }))).details).toEqual({ field: "name" });
  });

  it("checks the name, the cycle and the hike before it looks at either tab", async () => {
    const input = { scheduleTab: "Schedule", schedule: [], settings: [], portions: [] } satisfies PlanInput;
    expect((await refusal(() => planAddPortion(input, { ...NEW, name: "" }))).message).toBe("Portion name must be 1 to 60 characters.");
    expect((await refusal(() => planAddPortion(input, { ...NEW, cycleLength: 0 }))).details).toEqual({ field: "cycleLength" });
    expect((await refusal(() => planAddPortion(input, { ...NEW, hikePercent: 101 }))).details).toEqual({ field: "hikePercent" });
  });

  /** A Sheet with `count` portions (ids p1 to p{count}), headers Tenant, Count, Amount, Tenant2 and so on, in rows 2 and on. */
  function crowded(count: number) {
    const portions: PortionConfig[] = Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Room ${i + 1}`,
      tenantHeader: i === 0 ? "Tenant" : `Tenant${i + 1}`,
      countHeader: i === 0 ? "Count" : `Count${i + 1}`,
      amountHeader: i === 0 ? "Amount" : `Amount${i + 1}`,
      cycleLength: 11,
      hikePercent: 5,
    }));
    const settings: unknown[][] = [
      ["Portion", "Name", "Tenant header", "Count header", "Amount header", "Cycle length", "Hike %", "Active"],
      ...portions.map((p) => [p.id, p.name, p.tenantHeader, p.countHeader, p.amountHeader, 11, 5]),
    ];
    const schedule: unknown[][] = [["Month", ...portions.flatMap((p) => [p.tenantHeader, p.countHeader, p.amountHeader])], ["Aug-26"]];
    return { scheduleTab: "Schedule", schedule, settings, portions } satisfies PlanInput;
  }

  it("takes a twentieth portion and refuses a twenty-first", () => {
    expect(planAddPortion(crowded(19), NEW).id).toBe("p20");
    const error = refusalNow(() => planAddPortion(crowded(20), NEW));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("You can have at most 20 portions.");
  });
});

describe("planAddPortion: the portion's id", () => {
  it("is p{k} for the smallest k no row of Settings column A uses, case and spaces aside", async () => {
    const grid = settingsGrid();
    grid.splice(3, 1); // p3's row is gone
    expect(planAddPortion(await inputFor(world(grid)), NEW).id).toBe("p3");
    const withNote = settingsGrid();
    withNote[6] = [" P6 ", "a note that happens to start with an id"];
    expect(planAddPortion(await inputFor(world(withNote)), NEW).id).toBe("p7");
  });

  it("skips ids the Tenants tab still refers to, so a removed portion's history never turns up under a new one", async () => {
    const grid = settingsGrid();
    grid.splice(3, 1);
    expect(planAddPortion(await inputFor(world(grid), { retiredIds: ["p3", "P6"] }), NEW).id).toBe("p7");
  });
});

describe("planAddPortion: the headers", () => {
  it("follows the Schedule's own style: a space before the number when the last portion's Tenant header has one", async () => {
    const schedule = baseSchedule();
    schedule[2] = ["Month", "Tenant 1", "Count 1", "Amount 1", "Tenant 2", "Count 2", "Amount 2", "Tenant 3", "Count 3", "Amount 3", "Tenant 4", "Count 4", "Amount 4", "Tenant 5", "Count 5", "Amount 5", TOTAL_HEADER];
    const settings = settingsGrid();
    PORTIONS.forEach((_, i) => settings[i + 1].splice(2, 3, ...headerTriple(i + 1, " ")));
    const fake = world(settings, schedule);
    const plan = planAddPortion(await inputFor(fake), NEW);
    expect(plan.headers).toEqual(["Tenant 6", "Count 6", "Amount 6"]);
    const after = await applied(fake, [...plan.scheduleWrites, ...plan.settingsWrites]);
    const snapshot = await loadSnapshot(ctxOf(after));
    expect(snapshot.layout.portionCols.get("p6")).toEqual({ tenant: 17, count: 18, amount: 19 });
  });

  it("takes the last portion's style, not the first's", async () => {
    // p1 is "Tenant" and p5 is "Tenant5" in the fixture: no space. Give only p5 a spaced header.
    const schedule = baseSchedule();
    (schedule[2] as string[])[13] = "Tenant 5";
    const settings = settingsGrid();
    settings[5][2] = "Tenant 5";
    expect(planAddPortion(await inputFor(world(settings, schedule)), NEW).headers).toEqual(["Tenant 6", "Count 6", "Amount 6"]);
  });

  it("is the smallest number from 2 up whose three names are in neither the header row nor Settings", async () => {
    // Tenant6 is in the header row with nothing around it: the number is taken, so the portion gets 7.
    const schedule = withCells([[3, 17, "Tenant6"]]);
    const plan = planAddPortion(await inputFor(world(settingsGrid(), schedule)), NEW);
    expect(plan.headers).toEqual(["Tenant7", "Count7", "Amount7"]);
    expect(plan.columns).toEqual([18, 19, 20]);
  });

  it("counts a name that only a Settings row holds as taken, in any cell of any row, any case, either style", async () => {
    const settings = settingsGrid();
    for (const note of ["amount6", "COUNT 6", " Tenant6 "]) {
      settings[6] = ["note", note]; // a note row: its Tenant, Count and Amount cells are blank
      expect(planAddPortion(await inputFor(world(settings)), NEW).headers).toEqual(["Tenant7", "Count7", "Amount7"]);
    }
    // a cell that only mentions a name is not that name
    settings[6] = ["note", "Count6 is reserved for the shop"];
    expect(planAddPortion(await inputFor(world(settings)), NEW).headers).toEqual(["Tenant6", "Count6", "Amount6"]);
  });

  it("counts a number as taken when its names are in the header row in the other style: no Tenant 2 beside a Tenant2", async () => {
    const schedule = withCells([[3, 17, "Tenant 6"]]);
    expect(planAddPortion(await inputFor(world(settingsGrid(), schedule)), NEW).headers).toEqual(["Tenant7", "Count7", "Amount7"]);
  });

  it("recognises a header by the looser rule: a double space or a no-break space in the header row takes the number", async () => {
    const schedule = withCells([[3, 17, "Tenant 6"]]);
    expect(planAddPortion(await inputFor(world(settingsGrid(), schedule)), { ...NEW, name: "X" }).headers).toEqual(["Tenant7", "Count7", "Amount7"]);
  });
});

describe("planAddPortion: where the three columns go", () => {
  it("starts right of the right-most cell in any row, so something in column AB of row 9 pushes them to AC", async () => {
    const schedule = withCells([[9, 27, "a note far to the right"]]);
    const fake = world(settingsGrid(), schedule);
    const plan = planAddPortion(await inputFor(fake), NEW);
    expect(plan.columns).toEqual([28, 29, 30]);
    expect(plan.minColumns).toBe(31);
    expect(plan.scheduleWrites).toEqual([{ tab: "Schedule", a1: "AC3:AE3", values: [["Tenant6", "Count6", "Amount6"]] }]);
    const after = await applied(fake, [...plan.scheduleWrites, ...plan.settingsWrites]);
    expectOnlyPlanned(fake, after, [...plan.scheduleWrites, ...plan.settingsWrites]);
    const snapshot = await loadSnapshot(ctxOf(after));
    expect(snapshot.layout.portionCols.get("p6")).toEqual({ tenant: 28, count: 29, amount: 30 });
    expect(snapshot.rows).toHaveLength(2);
  });

  it("counts a formula, a number and a cell of spaces as something, so none of them is ever written over", async () => {
    for (const value of ["=SUM(A1:B1)", 42, "   "]) {
      const plan = planAddPortion(await inputFor(world(settingsGrid(), withCells([[2, 20, value]]))), NEW);
      expect(plan.columns).toEqual([21, 22, 23]);
    }
  });

  it("counts a cell above the header (a banner) and one in a footer row under the months", async () => {
    expect(planAddPortion(await inputFor(world(settingsGrid(), withCells([[1, 22, "banner"]]))), NEW).columns).toEqual([23, 24, 25]);
    expect(planAddPortion(await inputFor(world(settingsGrid(), withCells([[12, 18, "Grand total"]]))), NEW).columns).toEqual([19, 20, 21]);
  });

  it("goes in the three columns right after the Total column when nothing lies further right", async () => {
    const plan = planAddPortion(await inputFor(world()), NEW);
    expect(plan.columns).toEqual([17, 18, 19]);
    expect(colLetter(17)).toBe("R");
  });

  it("uses the last three columns of the range, up to ZZ, and refuses past them", async () => {
    const lastTaken = 698; // ZW
    const fits = planAddPortion(await inputFor(world(settingsGrid(), withCells([[9, lastTaken, "x"]]))), NEW);
    expect(fits.columns).toEqual([699, 700, 701]);
    expect(fits.scheduleWrites[0].a1).toBe("ZX3:ZZ3");

    const input = await inputFor(world(settingsGrid(), withCells([[9, lastTaken + 1, "x"]])));
    const error = await refusal(() => planAddPortion(input, NEW));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("Your Schedule has no room for three more columns (it is full up to column ZZ).");
  });
});

describe("planAddPortion: columns the owner has already added by hand", () => {
  /** The fixture Schedule with Tenant6, Count6 and Amount6 typed into the header row at `col`, and nothing below. */
  const handAdded = (col: number, n: number | string = 6, space = "") =>
    withCells(headerTriple(n, space).map((text, i) => [3, col + i, text] as [number, number, unknown]));

  it("uses an exact, adjacent triple that Settings does not use and that has nothing below it, and writes nothing to the Schedule", async () => {
    const fake = world(settingsGrid(), handAdded(17));
    const plan = planAddPortion(await inputFor(fake), NEW);
    expect(plan).toMatchObject({ id: "p6", headers: ["Tenant6", "Count6", "Amount6"], columns: [17, 18, 19], adopted: true, minColumns: 20, scheduleWrites: [] });
    expect(plan.settingsWrites[0].values).toEqual([["p6", "Back room", "Tenant6", "Count6", "Amount6", 11, 5]]);
    const after = await applied(fake, plan.settingsWrites);
    expect(changedCells(fake, after, "Schedule")).toEqual([]);
    const snapshot = await loadSnapshot(ctxOf(after));
    expect(snapshot.layout.portionCols.get("p6")).toEqual({ tenant: 17, count: 18, amount: 19 });
  });

  it("uses it wherever it is, with other columns between it and the Total column", async () => {
    const plan = planAddPortion(await inputFor(world(settingsGrid(), handAdded(22))), NEW);
    expect(plan).toMatchObject({ adopted: true, columns: [22, 23, 24], minColumns: 25, scheduleWrites: [] });
  });

  it("resumes an add that wrote the headers and stopped before the Settings row: the same columns, no second set", async () => {
    const fake = world();
    const first = planAddPortion(await inputFor(fake), NEW);
    await fake.updateValues(first.scheduleWrites); // the Settings write never happened
    const again = planAddPortion(await inputFor(fake), NEW);
    expect(again).toMatchObject({ id: "p6", headers: first.headers, columns: first.columns, adopted: true, scheduleWrites: [] });
    expect(again.settingsWrites).toEqual(first.settingsWrites);
    const done = await applied(fake, again.settingsWrites);
    const snapshot = await loadSnapshot(ctxOf(done));
    expect(snapshot.portions).toHaveLength(6);
    expect(done.tabs.get("Schedule")![2]).toHaveLength(20); // still one set of headers
  });

  it("prefers a triple the owner added over fresh columns, even one numbered above the first free number", async () => {
    const plan = planAddPortion(await inputFor(world(settingsGrid(), handAdded(17, 7))), NEW);
    expect(plan).toMatchObject({ headers: ["Tenant7", "Count7", "Amount7"], columns: [17, 18, 19], adopted: true });
  });

  it("takes the smallest number when there are two", async () => {
    const schedule = handAdded(17, 8);
    for (const [i, text] of headerTriple(6).entries()) schedule[2][20 + i] = text;
    const plan = planAddPortion(await inputFor(world(settingsGrid(), schedule)), NEW);
    expect(plan).toMatchObject({ headers: ["Tenant6", "Count6", "Amount6"], columns: [20, 21, 22], adopted: true });
  });

  it("follows the Sheet's style for what counts as the pattern", async () => {
    const schedule = baseSchedule();
    (schedule[2] as string[])[13] = "Tenant 5";
    const settings = settingsGrid();
    settings[5][2] = "Tenant 5";
    const spaced = withCells(headerTriple(6, " ").map((text, i) => [3, 17 + i, text] as [number, number, unknown]), schedule);
    expect(planAddPortion(await inputFor(world(settings, spaced)), NEW)).toMatchObject({ adopted: true, headers: ["Tenant 6", "Count 6", "Amount 6"] });
  });

  it("does not use a triple that has anything below its header: that is somebody's history", async () => {
    const schedule = handAdded(17);
    schedule[3][17] = "Dev"; // R4
    const plan = planAddPortion(await inputFor(world(settingsGrid(), schedule)), NEW);
    expect(plan.adopted).toBe(false);
    expect(plan.headers).toEqual(["Tenant7", "Count7", "Amount7"]);
    expect(plan.columns).toEqual([20, 21, 22]);
  });

  it.each([
    ["a cell of spaces under it", 5, 18, "  "],
    ["a formula under it", 5, 19, "=D5"],
    ["a cell further down", 12, 17, 0],
  ])("does not use a triple with %s", async (_name, row, col, value) => {
    const schedule = withCells([[row as number, col as number, value]], handAdded(17));
    expect(planAddPortion(await inputFor(world(settingsGrid(), schedule)), NEW).adopted).toBe(false);
  });

  it("does not use a triple Settings already points at, and does not give a second portion its names", async () => {
    const settings = settingsGrid();
    settings[6] = ["p6", "Hand-made", "Tenant6", "Count6", "Amount6", 11, 5];
    const fake = world(settings, handAdded(17));
    const plan = planAddPortion(await inputFor(fake), NEW);
    expect(plan.id).toBe("p7");
    expect(plan.adopted).toBe(false);
    expect(plan.headers).toEqual(["Tenant7", "Count7", "Amount7"]);
    expect(plan.settingsRow).toBe(8);
  });

  it("does not use a triple whose names are not exactly the pattern, or are not side by side, or are twice in the header row", async () => {
    // lower case, and a double space: not exact (and the number is taken, so the new portion gets 7)
    for (const triple of [["tenant6", "count6", "amount6"], ["Tenant6", "Count6", "Amount  6"]]) {
      const schedule = withCells(triple.map((text, i) => [3, 17 + i, text] as [number, number, unknown]));
      expect(planAddPortion(await inputFor(world(settingsGrid(), schedule)), NEW).adopted).toBe(false);
    }
    // not adjacent
    const apart = withCells([[3, 17, "Tenant6"], [3, 19, "Count6"], [3, 21, "Amount6"]]);
    expect(planAddPortion(await inputFor(world(settingsGrid(), apart)), NEW)).toMatchObject({ adopted: false, headers: ["Tenant7", "Count7", "Amount7"] });
    // out of order
    const mixed = withCells([[3, 17, "Count6"], [3, 18, "Tenant6"], [3, 19, "Amount6"]]);
    expect(planAddPortion(await inputFor(world(settingsGrid(), mixed)), NEW).adopted).toBe(false);
    // one of the three twice
    const twice = withCells([[3, 25, "Count6"]], handAdded(17));
    expect(planAddPortion(await inputFor(world(settingsGrid(), twice)), NEW).adopted).toBe(false);
  });

  it("does not use a triple whose number is below 2", async () => {
    const plan = planAddPortion(await inputFor(world(settingsGrid(), handAdded(17, 1))), NEW);
    expect(plan.adopted).toBe(false);
    expect(plan.headers).toEqual(["Tenant6", "Count6", "Amount6"]);
    expect(plan.columns).toEqual([20, 21, 22]);
  });
});

describe("planAddPortion: the row in the Settings tab", () => {
  it("is the first row under the last portion whose cells A to Z are all blank", async () => {
    const plan = planAddPortion(await inputFor(world()), NEW);
    expect(plan.settingsRow).toBe(7);
  });

  it("skips a note under the table and never writes to it", async () => {
    const settings = settingsGrid();
    settings[6] = ["Notes: rents are in rupees"];
    settings[7] = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "a note further right in row 8"];
    const fake = world(settings);
    const plan = planAddPortion(await inputFor(fake), NEW);
    expect(plan.settingsRow).toBe(9);
    const after = await applied(fake, [...plan.scheduleWrites, ...plan.settingsWrites]);
    expectOnlyPlanned(fake, after, [...plan.scheduleWrites, ...plan.settingsWrites]);
    expect(after.tabs.get(SETTINGS_TAB)![6]).toEqual(["Notes: rents are in rupees"]);
    expect((await loadSnapshot(ctxOf(after))).portions.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
  });

  it("counts a cell with only spaces, and a cell in column Z, as something", async () => {
    const settings = settingsGrid();
    settings[6] = ["  "];
    settings[7] = [];
    settings[7][25] = "far right";
    expect(planAddPortion(await inputFor(world(settings)), NEW).settingsRow).toBe(9);
  });

  it("goes under the last portion, not into a blank row among the others", async () => {
    const settings = settingsGrid();
    settings.splice(3, 0, []); // a blank row 4 between p2 and p3
    const fake = world(settings);
    const plan = planAddPortion(await inputFor(fake), NEW);
    expect(plan.settingsRow).toBe(8);
    expect(plan.id).toBe("p6");
    const after = await applied(fake, [...plan.scheduleWrites, ...plan.settingsWrites]);
    expect((await loadSnapshot(ctxOf(after))).portions.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
  });

  it("can be row 50, and is refused when the notes fill every row up to it", async () => {
    const settings = settingsGrid();
    for (let row = 7; row <= 49; row++) settings[row - 1] = [`note ${row}`];
    const fake = world(settings);
    expect(planAddPortion(await inputFor(fake), NEW).settingsRow).toBe(50);
    settings[49] = ["note 50"];
    const error = await refusal(async () => planAddPortion(await inputFor(world(settings)), NEW));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("The Settings tab has no free row up to row 50 for a new portion. Clear an unused row, then try again.");
  });
});

describe("planAddPortion: the input it is given", () => {
  it("is refused as a conflict when the portions it was told of are not the rows the Settings read now holds", async () => {
    const input = await inputFor(world());
    const changed = { ...input, settings: [...input.settings, ["p6", "Someone's", "Tenant6", "Count6", "Amount6", 11, 5]] };
    const error = await refusal(() => planAddPortion(changed, NEW));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("Someone changed the Settings tab a moment ago. Tap another tab at the bottom of the screen and come back, then try again.");
  });

  it("does not change what it is given", async () => {
    const input = await inputFor(world());
    const copy = structuredClone(input);
    planAddPortion(input, NEW);
    expect(input).toEqual(copy);
  });
});

describe("planSetActive", () => {
  it("switches a portion off by writing No in its H cell, and Active in H1 when H1 is blank", async () => {
    const fake = world(settingsGrid()); // the owner's: H1 blank
    const writes = planSetActive(await inputFor(fake), "p4", false);
    expect(writes).toEqual([
      { tab: SETTINGS_TAB, a1: "H1", values: [["Active"]] },
      { tab: SETTINGS_TAB, a1: "H5", values: [["No"]] },
    ]);
    const after = await applied(fake, writes);
    expectOnlyPlanned(fake, after, writes);
    expect((await readSettings(after)).map((p) => [p.id, p.inactive ?? false])).toEqual([
      ["p1", false], ["p2", false], ["p3", false], ["p4", true], ["p5", false],
    ]);
  });

  it("writes only the portion's cell when H1 already says Active, in any case or spacing", async () => {
    for (const header of ["Active", " ACTIVE "]) {
      const grid = settingsGridWithActive();
      grid[0][7] = header;
      expect(planSetActive(await inputFor(world(grid)), "p2", false)).toEqual([{ tab: SETTINGS_TAB, a1: "H3", values: [["No"]] }]);
    }
  });

  it("switches a portion on with Yes, leaving H1 alone, and the app then reads it as on", async () => {
    const fake = world(settingsGridWithActive({ p4: "No" }));
    const writes = planSetActive(await inputFor(fake), "p4", true);
    expect(writes).toEqual([{ tab: SETTINGS_TAB, a1: "H5", values: [["Yes"]] }]);
    const after = await applied(fake, writes);
    expect((await readSettings(after)).some((p) => p.inactive)).toBe(false);
  });

  it.each([["inactive"], ["off"], [false], ["false"], [" No "]])("reads %j as off, so switching on writes Yes", async (flag) => {
    expect(planSetActive(await inputFor(world(settingsGridWithActive({ p2: flag }))), "p2", true)).toEqual([
      { tab: SETTINGS_TAB, a1: "H3", values: [["Yes"]] },
    ]);
  });

  it("writes nothing to switch on a portion that is already on, with an Active column or without one", async () => {
    expect(planSetActive(await inputFor(world(settingsGridWithActive({ p1: "Yes" }))), "p1", true)).toEqual([]);
    expect(planSetActive(await inputFor(world(settingsGridWithActive())), "p3", true)).toEqual([]);
    expect(planSetActive(await inputFor(world(settingsGrid())), "p3", true)).toEqual([]);
  });

  it("writes nothing to switch off a portion that is already off", async () => {
    expect(planSetActive(await inputFor(world(settingsGridWithActive({ p3: "off" }))), "p3", false)).toEqual([]);
  });

  it("writes to the row the portion really sits on, past a note between portions", async () => {
    const settings = settingsGridWithActive();
    settings.splice(3, 0, ["a note between p2 and p3"]);
    const fake = world(settings);
    expect(planSetActive(await inputFor(fake), "p3", false)).toEqual([{ tab: SETTINGS_TAB, a1: "H5", values: [["No"]] }]);
  });

  it("refuses a portion it does not know", async () => {
    const error = await refusal(async () => planSetActive(await inputFor(world()), "p9", false));
    expect(error.code).toBe("validation");
    expect(error.message).toContain("That portion isn't in your Settings any more.");
  });

  const H1_TAKEN =
    "Cell H1 of the Settings tab holds other text. RentBook keeps the Active setting in column H: move that column further right, then try again.";
  const NOT_YES_OR_NO = (cell: string) => `Cell ${cell} of the Settings tab is not Yes or No. Type Yes or No in that cell, then try again.`;
  const IN_USE = (cell: string) =>
    `Cell ${cell} of the Settings tab already holds something. RentBook keeps the Active setting in column H: move that column further right, then try again.`;

  it("refuses when H1 holds other text, naming the cell and not what it holds, and writes nothing", async () => {
    const grid = settingsGrid();
    grid[0][7] = "Notes";
    for (const active of [true, false]) {
      const error = await refusal(async () => planSetActive(await inputFor(world(grid)), "p2", active));
      expect(error.code).toBe("validation");
      expect(error.message).toBe(H1_TAKEN);
      expect(error.message).not.toContain("Notes");
    }
  });

  it("refuses when a portion's H cell holds something that is not Yes or No, even a portion it was not asked about, and says what to type", async () => {
    for (const value of ["maybe", "x", "N", "0", "No.", "nope", "disabled", 0, 5]) {
      const grid = settingsGridWithActive({ p4: value });
      const error = await refusal(async () => planSetActive(await inputFor(world(grid)), "p2", false));
      expect(error.code).toBe("validation");
      expect(error.message).toBe(NOT_YES_OR_NO("H5")); // the cell, never what it holds
    }
  });

  it("names the first such cell, in sheet order, when there are several", async () => {
    const grid = settingsGridWithActive({ p5: "x", p3: "y" });
    const error = await refusal(async () => planSetActive(await inputFor(world(grid)), "p1", false));
    expect(error.message).toBe(NOT_YES_OR_NO("H4"));
  });

  it("treats a cell of spaces as taken, not as blank: it is never written over", async () => {
    for (const [grid, cell] of [
      [(() => { const g = settingsGrid(); g[0][7] = "   "; return g; })(), "H1"],
      [(() => { const g = settingsGridWithActive(); g[2][7] = "  "; return g; })(), "H3"],
    ] as const) {
      const error = await refusal(async () => planSetActive(await inputFor(world(grid)), "p4", false));
      expect(error.message).toBe(cell === "H1" ? H1_TAKEN : NOT_YES_OR_NO(cell));
    }
    const blankH1 = settingsGrid();
    blankH1[2][7] = " ";
    expect((await refusal(async () => planSetActive(await inputFor(world(blankH1)), "p4", false))).message).toBe(IN_USE("H3"));
  });

  it("refuses to claim a column that already holds the owner's own values under a blank H1: Active would turn them into settings", async () => {
    const grid = settingsGrid();
    grid[2][7] = "No";
    const error = await refusal(async () => planSetActive(await inputFor(world(grid)), "p4", false));
    expect(error.message).toBe(IN_USE("H3"));
    expect(error.message).not.toContain("No.");
    // and with H1 blank and H empty everywhere, it is fine
    expect(planSetActive(await inputFor(world(settingsGrid())), "p4", false)).toHaveLength(2);
  });

  it("puts the Active header first, so a request that is cut short after its first range cannot leave a flag under a blank H1", async () => {
    const writes = planSetActive(await inputFor(world(settingsGrid())), "p4", false);
    expect(writes.map((write) => write.a1)).toEqual(["H1", "H5"]);
  });

  describe("switching on a portion whose columns may be gone", () => {
    const gone = () => {
      const schedule = baseSchedule();
      (schedule[2] as string[]).splice(10, 3); // p4's three headers
      return schedule;
    };

    it("is refused when its three headers are no longer in the Schedule, because every page would fail", async () => {
      const error = await refusal(async () =>
        planSetActive(await inputFor(world(settingsGridWithActive({ p4: "No" }), gone())), "p4", true),
      );
      expect(error.code).toBe("validation");
      expect(error.message).toBe(
        "Second floor, double bedroom can't be switched on: its columns (Tenant4, Count4 and Amount4) are not in the Schedule's header row, once each. Put them back, then try again.",
      );
    });

    it("is refused when only some of them are there, or one of them is there twice", async () => {
      const some = baseSchedule();
      (some[2] as string[])[12] = "Rent";
      const twice = baseSchedule();
      (twice[2] as string[])[17] = "Tenant4";
      for (const schedule of [some, twice]) {
        const error = await refusal(async () =>
          planSetActive(await inputFor(world(settingsGridWithActive({ p4: "No" }), schedule)), "p4", true),
        );
        expect(error.code).toBe("validation");
        expect(error.message).toContain("can't be switched on");
      }
    });

    it("is allowed while its columns are there, and switching one off never looks at them", async () => {
      expect(planSetActive(await inputFor(world(settingsGridWithActive({ p4: "No" }))), "p4", true)).toHaveLength(1);
      expect(planSetActive(await inputFor(world(settingsGridWithActive(), gone().map((row) => row))), "p3", false)).toHaveLength(1);
    });
  });
});

describe("planReorder", () => {
  const ids = (list: string[]) => list;

  async function reordered(newOrder: string[], settings = settingsGrid(), schedule = baseSchedule()) {
    const fake = world(settings, schedule);
    const writes = planReorder(await inputFor(fake), newOrder);
    return { fake, writes, after: await applied(fake, writes) };
  }

  it("swaps two portions' rows: each of the two rows gets the other's cells, A to H when the tab has an Active column", async () => {
    const { writes } = await reordered(["p2", "p1", "p3", "p4", "p5"], settingsGridWithActive({ p2: "No" }));
    expect(writes).toEqual([
      { tab: SETTINGS_TAB, a1: "A2:H2", values: [["p2", "First floor, double bedroom", "Tenant2", "Count2", "Amount2", 11, 5, "No"]] },
      { tab: SETTINGS_TAB, a1: "A3:H3", values: [["p1", "First floor, single bedroom", "Tenant", "Count", "Amount", 11, 5, ""]] },
    ]);
  });

  it("writes nothing for an order that has not changed", async () => {
    const { writes } = await reordered(["p1", "p2", "p3", "p4", "p5"]);
    expect(writes).toEqual([]);
  });

  it("writes only the rows that change", async () => {
    const { writes } = await reordered(["p1", "p2", "p4", "p3", "p5"], settingsGridWithActive());
    expect(writes.map((write) => write.a1)).toEqual(["A4:H4", "A5:H5"]);
  });

  it("moves the last portion to the front: every row changes, and the app reads the new order with each portion's own settings", async () => {
    const settings = settingsGridWithActive({ p3: "No" });
    settings[2][5] = ""; // p2 never resets
    settings[4][6] = 7.5; // p4's hike
    const { fake, writes, after } = await reordered(["p5", "p1", "p2", "p3", "p4"], settings);
    expect(writes).toHaveLength(5);
    expectOnlyPlanned(fake, after, writes);
    const portions = await readSettings(after);
    expect(portions.map((p) => p.id)).toEqual(["p5", "p1", "p2", "p3", "p4"]);
    const before = await readSettings(world(settings));
    for (const portion of portions) expect(portion).toEqual(before.find((p) => p.id === portion.id));
    expect(portions.find((p) => p.id === "p3")?.inactive).toBe(true);
    expect(portions.find((p) => p.id === "p2")?.cycleLength).toBeNull();
    expect(portions.find((p) => p.id === "p4")?.hikePercent).toBe(7.5);
  });

  it("never moves a Schedule column: each portion keeps its columns and entries, and the cards come in the new order", async () => {
    const { fake, after } = await reordered(["p3", "p2", "p1", "p5", "p4"]);
    const before = await loadSnapshot(ctxOf(world()));
    const snapshot = await loadSnapshot(ctxOf(after));
    expect(changedCells(fake, after, "Schedule")).toEqual([]);
    for (const portion of PORTIONS) {
      expect(snapshot.layout.portionCols.get(portion.id)).toEqual(before.layout.portionCols.get(portion.id));
      snapshot.rows.forEach((row, index) => expect(row.entries.get(portion.id)).toEqual(before.rows[index].entries.get(portion.id)));
    }
    const view = await getMonthView(ctxOf(after), OCT);
    expect(view.cards.map((card) => card.portionId)).toEqual(["p3", "p2", "p1", "p5", "p4"]);
    expect(view.due).toBe((await getMonthView(ctxOf(world()), OCT)).due);
  });

  it("carries the Active cells with the portions when the tab has an Active column, and leaves column H where it is when it has not", async () => {
    const withColumn = await reordered(["p2", "p1", "p3", "p4", "p5"], settingsGridWithActive({ p1: "No" }));
    expect((await readSettings(withColumn.after)).map((p) => [p.id, p.inactive ?? false])).toEqual([
      ["p2", false], ["p1", true], ["p3", false], ["p4", false], ["p5", false],
    ]);

    const owners = settingsGrid();
    owners[1][7] = "kept with the row"; // H2 holds a note of the owner's, under a blank H1
    const without = await reordered(["p2", "p1", "p3", "p4", "p5"], owners);
    expect(without.writes.map((write) => write.a1)).toEqual(["A2:G2", "A3:G3"]);
    expect(without.after.tabs.get(SETTINGS_TAB)![1][7]).toBe("kept with the row");
  });

  it("moves portions past a note between portion rows: the slots are the portion rows, the note stays", async () => {
    const settings = settingsGridWithActive();
    settings.splice(3, 0, ["a note between p2 and p3"]);
    const { fake, writes, after } = await reordered(["p3", "p2", "p1", "p4", "p5"], settings);
    expect(writes.map((write) => write.a1)).toEqual(["A2:H2", "A5:H5"]);
    expect(after.tabs.get(SETTINGS_TAB)![3]).toEqual(["a note between p2 and p3"]);
    expectOnlyPlanned(fake, after, writes);
    expect((await readSettings(after)).map((p) => p.id)).toEqual(["p3", "p2", "p1", "p4", "p5"]);
  });

  it("writes the values as they were read: a number stays a number, a blank stays blank, a check box stays a check box", async () => {
    const settings = settingsGridWithActive({ p2: false, p1: true });
    settings[2][5] = undefined;
    const { writes, after } = await reordered(["p2", "p1", "p3", "p4", "p5"], settings);
    expect(writes[0].values).toEqual([["p2", "First floor, double bedroom", "Tenant2", "Count2", "Amount2", "", 5, false]]);
    expect(writes[1].values).toEqual([["p1", "First floor, single bedroom", "Tenant", "Count", "Amount", 11, 5, true]]);
    expect(after.tabs.get(SETTINGS_TAB)![1][7]).toBe(false);
  });

  it.each([
    ["one fewer", ["p1", "p2", "p3", "p4"]],
    ["one more", ["p1", "p2", "p3", "p4", "p5", "p6"]],
    ["an id twice", ["p1", "p2", "p3", "p4", "p4"]],
    ["an id it does not know", ["p1", "p2", "p3", "p4", "p9"]],
    ["nothing", []],
    ["an id in other capitals", ["P1", "p2", "p3", "p4", "p5"]],
  ])("is a conflict when the ids are %s, not the portions there are", async (_name, order) => {
    const error = await refusal(async () => planReorder(await inputFor(world()), order));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(CHANGED);
  });

  it("refuses a formula in a row it would move, naming the row, and writes nothing", async () => {
    const settings = settingsGridWithActive();
    settings[2][6] = "=G2"; // row 3: p2's hike
    const error = await refusal(async () => planReorder(await inputFor(world(settings)), ["p2", "p1", "p3", "p4", "p5"]));
    expect(error.code).toBe("validation");
    expect(error.message).toBe("Settings row 3 has a formula in it, which RentBook cannot move. Replace it with its value, then try again.");
  });

  it("names the first row with a formula, and also finds one in the Active cell and in the id", async () => {
    const settings = settingsGridWithActive();
    settings[1][1] = '=CONCATENATE("a","b")';
    settings[2][7] = "=TRUE";
    const error = await refusal(async () => planReorder(await inputFor(world(settings)), ["p2", "p1", "p3", "p4", "p5"]));
    expect(error.message).toContain("Settings row 2 has a formula");
    const second = settingsGridWithActive();
    second[2][7] = "=TRUE";
    const again = await refusal(async () => planReorder(await inputFor(world(second)), ["p2", "p1", "p3", "p4", "p5"]));
    expect((again as AppError).message).toContain("Settings row 3 has a formula");
  });

  it("does not mind a formula in a row that stays where it is, or in a column that is not moved", async () => {
    const settings = settingsGridWithActive();
    settings[4][6] = "=G2"; // p4 does not move
    settings[1][8] = "=1+1"; // column I of p1's row: not one of the moved cells
    const { writes } = await reordered(["p2", "p1", "p3", "p4", "p5"], settings);
    expect(writes).toHaveLength(2);
  });

  it("does not mind a formula under the table", async () => {
    const settings = settingsGridWithActive();
    settings[8] = ["=SUM(F2:F6)"];
    const { writes } = await reordered(["p2", "p1", "p3", "p4", "p5"], settings);
    expect(writes).toHaveLength(2);
  });

  it("does not change what it is given", async () => {
    const input = await inputFor(world());
    const copy = structuredClone(input);
    planReorder(input, ["p5", "p4", "p3", "p2", "p1"]);
    expect(input).toEqual(copy);
    expect(ids(input.portions.map((p) => p.id))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
});

describe("planTotalNote", () => {
  const plan = (): AddPlan => ({
    id: "p6",
    headers: ["Tenant6", "Count6", "Amount6"],
    columns: [17, 18, 19],
    adopted: false,
    minColumns: 20,
    headerRow: 3,
    settingsRow: 7,
    scheduleWrites: [],
    settingsWrites: [],
  });
  const layout = { totalCol: 16, lastDataRow: 5 };

  it("tells the owner which column to add to the total when the total is a formula", () => {
    expect(planTotalNote(baseSchedule(), layout, TOTAL_HEADER, plan(), "Back room")).toBe(
      "Your Total Rent column adds up the amounts with a formula. Add column T (Amount6) to it in your Sheet so the total includes Back room.",
    );
  });

  it("says nothing when the total holds typed numbers (the app keeps those up to date), or there is no total column", () => {
    const typed = baseSchedule();
    typed[4] = scheduleRow(monthCell("text", 2026, 9), [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], null, ["Esha", 1, 5100]], 5, 32250);
    expect(planTotalNote(typed, layout, TOTAL_HEADER, plan(), "Back room")).toBeNull();
    expect(planTotalNote(baseSchedule(), { totalCol: null, lastDataRow: 5 }, null, plan(), "Back room")).toBeNull();
  });

  it("reads the total from the last month's row, and says nothing when that cell is empty", () => {
    const empty = baseSchedule();
    delete (empty[4] as unknown[])[16];
    expect(planTotalNote(empty, layout, TOTAL_HEADER, plan(), "Back room")).toBeNull();
  });
});
