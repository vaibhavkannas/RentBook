import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import {
  ensureTabs,
  inferPortions,
  LOG_HEADERS,
  LOG_TAB,
  readSettings,
  SETTINGS_TAB,
  updateSettings,
} from "@/lib/sheets/settings-store";
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { captureLogs, loggedLines } from "../support/logs";
import { baseSchedule, PORTIONS, SCHEDULE_HEADERS, settingsGrid } from "../support/fixtures";

describe("inferPortions", () => {
  it("builds five portions with default names, cycle 11 and hike 5", () => {
    const portions = inferPortions(SCHEDULE_HEADERS);
    expect(portions).toHaveLength(5);
    expect(portions[0]).toEqual({
      id: "p1",
      name: "First floor, single bedroom",
      tenantHeader: "Tenant",
      countHeader: "Count",
      amountHeader: "Amount",
      cycleLength: 11,
      hikePercent: 5,
    });
    expect(portions[4]).toMatchObject({ id: "p5", tenantHeader: "Tenant5", amountHeader: "Amount5" });
  });

  it("refuses a Tenant column without Count and Amount after it", () => {
    expect(() => inferPortions(["Month", "Tenant", "Amount", "Count"])).toThrow(AppError);
  });

  it("refuses a header row with no Tenant columns", () => {
    expect(() => inferPortions(["Month", "Total"])).toThrow(/No "Tenant" columns/);
  });
});

describe("inferPortions: other columns between a portion's three", () => {
  const headers = (...cells: string[]) => ["Month", ...cells, "Total Rent"];
  const columnsOf = (portions: ReturnType<typeof inferPortions>) =>
    portions.map((p) => [p.tenantHeader, p.countHeader, p.amountHeader]);

  it("pairs a Tenant with a Count and an Amount that have a Phone column between them", () => {
    const portions = inferPortions(
      headers("Tenant", "Count", "Amount", "Tenant2", "Phone2", "Count2", "Amount2", "Tenant3", "Count3", "Notes3", "Amount3"),
    );
    expect(columnsOf(portions)).toEqual([
      ["Tenant", "Count", "Amount"],
      ["Tenant2", "Count2", "Amount2"],
      ["Tenant3", "Count3", "Amount3"],
    ]);
    expect(portions.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps the header text as it is typed, so the Schedule can be matched by it later", () => {
    const portions = inferPortions(headers(" Tenant  2 ", "Phone", "Count  2", "Amount 2"));
    expect(columnsOf(portions)).toEqual([["Tenant  2", "Count  2", "Amount 2"]]);
  });

  it("reads a header with a no-break or zero-width space as a Tenant, Count and Amount header", () => {
    const portions = inferPortions(headers("Tenant\u00a02", "Count\u200b 2", "Amount\u00a0\u00a02"));
    expect(columnsOf(portions)).toEqual([["Tenant\u00a02", "Count\u200b 2", "Amount\u00a0\u00a02"]]);
  });

  it("looks for the Count and the Amount only before the next Tenant header", () => {
    expect(() => inferPortions(headers("Tenant", "Phone", "Tenant2", "Count2", "Amount2"))).toThrow(
      /"Tenant" must be followed by a Count and an Amount/,
    );
  });

  it("looks for the Amount after the Count, never before it", () => {
    expect(() => inferPortions(headers("Tenant", "Amount", "Phone", "Count"))).toThrow(AppError);
    expect(() => inferPortions(["Month", "Tenant", "Amount", "Count"])).toThrow(AppError);
  });

  it("pairs a Tenant N with the Count N and Amount N of the same number when other columns sit between them", () => {
    expect(() => inferPortions(headers("Tenant2", "Phone", "Count", "Amount"))).toThrow(AppError);
    expect(columnsOf(inferPortions(headers("Tenant2", "Phone", "Count2", "Amount2")))).toEqual([
      ["Tenant2", "Count2", "Amount2"],
    ]);
  });

  it("still takes a Count and an Amount straight after the Tenant, whatever their numbers", () => {
    expect(columnsOf(inferPortions(headers("Tenant", "Count2", "Amount3")))).toEqual([["Tenant", "Count2", "Amount3"]]);
  });

  it("still refuses a Tenant-looking header it cannot read", () => {
    expect(() => inferPortions(headers("Tenant (1F double)", "Count", "Amount"))).toThrow(/looks like a Tenant column/);
    expect(() => inferPortions(headers("Tenant", "Count", "Amount", "Tenant (1F double)", "Count", "Amount"))).toThrow(
      /looks like a Tenant column/,
    );
  });

  it("still refuses the same header twice", () => {
    expect(() => inferPortions(headers("Tenant", "Count", "Amount", "Tenant", "Phone", "Count", "Amount"))).toThrow(
      /Header "Tenant" appears more than once/,
    );
    expect(() => inferPortions(headers("Tenant", "Count", "Amount", "Tenant2", "Count", "Amount2"))).toThrow(
      /Header "Count" appears more than once/,
    );
  });

  it("refuses a Count or an Amount whose header text another column in the header row has too, so a later rename cannot re-point it", () => {
    for (const row of [
      headers("Tenant", "Count", "Count", "Amount"),
      headers("Tenant", "Count", "Amount", "Count"),
      headers("Tenant", "Count", "Amount", "Amount"),
      headers("Tenant", "Count", "Amount", "count"),
      headers("Tenant", "Count", "Amount", " Amount "),
      headers("Tenant", "Count", "Amount", "Amount\u200b"),
      headers("Tenant", "Count", "Amount", "Amount\u00a0"),
      headers("Tenant", "Phone", "Count", "Amount", "Notes", "Count"),
    ]) {
      expect(() => inferPortions(row), JSON.stringify(row)).toThrow(/Header "(Count|Amount)" appears more than once/);
    }
  });

  it("still takes a Count and an Amount whose text is its own, with other columns around them", () => {
    expect(columnsOf(inferPortions(headers("Tenant", "Phone", "Count", "Amount", "Notes", "Total")))).toEqual([
      ["Tenant", "Count", "Amount"],
    ]);
  });

  it("still ignores Count and Amount columns that belong to no Tenant column", () => {
    expect(columnsOf(inferPortions(headers("Tenant", "Count", "Amount", "Count2", "Amount2")))).toEqual([
      ["Tenant", "Count", "Amount"],
    ]);
  });
});

describe("ensureTabs", () => {
  it("creates Settings, Payments Log and Tenants once, seeded from the Schedule header", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    expect([...fake.tabs.keys()]).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB, TENANTS_TAB]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    const portions = await readSettings(fake);
    expect(portions.map((p) => p.tenantHeader)).toEqual(PORTIONS.map((p) => p.tenantHeader));

    const callsBefore = fake.calls.length;
    await ensureTabs(fake, "Schedule");
    expect(fake.calls.length).toBe(callsBefore);
  });

  it("keeps existing Settings and only adds what is missing", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: [["Portion"], ["p1", "Ground", "Tenant", "Count", "Amount", 6, 8]],
    });
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.has(LOG_TAB)).toBe(true);
    const portions = await readSettings(fake);
    expect(portions).toHaveLength(1);
    expect(portions[0]).toMatchObject({ name: "Ground", cycleLength: 6, hikePercent: 8 });
  });

  it("fails clearly when the Schedule tab is missing", async () => {
    const fake = new FakeGateway({ Other: [] });
    await expect(ensureTabs(fake, "Schedule")).rejects.toThrow(/tab "Schedule" was not found/);
  });
});

describe("ensureTabs: Tenants tab", () => {
  it("creates the Tenants tab with its headers", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
  });

  it("creates the Tenants tab next to an existing Settings tab and Payments Log", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: settingsGrid(),
      [LOG_TAB]: [[...LOG_HEADERS]],
    });
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
  });

  it("leaves an existing correct Tenants tab and its rows alone", async () => {
    const data = ["t-1", "p1", "Asha", "", "2026-01-15"];
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: settingsGrid(),
      [LOG_TAB]: [[...LOG_HEADERS]],
      [TENANTS_TAB]: [[...TENANT_HEADERS], data],
    });
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS, data]);
    expect(fake.calls).not.toContain("addTab");
    expect(fake.calls).not.toContain("updateValues");
  });

  it("does not refuse a Tenants tab with a wrong header: the rest of the app must keep working", async () => {
    const wrong = [...TENANT_HEADERS];
    wrong[4] = "Moved in";
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: settingsGrid(),
      [TENANTS_TAB]: [wrong],
    });
    await expect(ensureTabs(fake, "Schedule")).resolves.toBeUndefined();
    // the Payments Log tab was still created, and the Tenants tab was left exactly as it was
    expect(fake.tabs.has(LOG_TAB)).toBe(true);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([wrong]);
  });
});

describe("ensureTabs: Payments Log header upgrade", () => {
  const oldHeaders = ["Saved at", "Month", "Portion", "Tenant", "Amount", "Count", "Date received"];
  const row = ["2026-09-05T00:00:00.000Z", "2026-09", "First floor, single bedroom", "Asha", 5450, 3, "2026-09-05"];

  async function run(logRows: unknown[][]) {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: settingsGrid(),
      [LOG_TAB]: logRows,
      // Already there, so these tests only measure what happens to the Payments Log.
      [TENANTS_TAB]: [[...TENANT_HEADERS]],
    });
    await ensureTabs(fake, "Schedule");
    return fake;
  }

  it("has nine log headers ending in Logged by and Action", () => {
    expect(LOG_HEADERS).toHaveLength(9);
    expect(LOG_HEADERS.slice(7)).toEqual(["Logged by", "Action"]);
  });

  it("adds Logged by and Action to an old header row and leaves data rows alone", async () => {
    const fake = await run([oldHeaders, row]);
    expect(fake.tabs.get(LOG_TAB)![0]).toEqual(LOG_HEADERS);
    expect(fake.tabs.get(LOG_TAB)![1]).toEqual(row);
  });

  it("completes a half-upgraded header that has Logged by but no Action", async () => {
    const fake = await run([[...oldHeaders, "Logged by"], row]);
    expect(fake.tabs.get(LOG_TAB)![0]).toEqual(LOG_HEADERS);
    expect(fake.tabs.get(LOG_TAB)![1]).toEqual(row);
  });

  it("writes nothing when the headers are already current", async () => {
    const fake = await run([[...LOG_HEADERS]]);
    const writes = fake.calls.filter((c) => c === "updateValues").length;
    expect(writes).toBe(0);
  });

  it("writes the whole header row into an empty Payments Log tab", async () => {
    const fake = await run([]);
    expect(fake.tabs.get(LOG_TAB)![0]).toEqual(LOG_HEADERS);
  });
});

describe("ensureTabs: Payments Log headers that are not ours", () => {
  const first7 = LOG_HEADERS.slice(0, 7);
  const row = ["2026-09-05T00:00:00.000Z", "2026-09", "First floor, single bedroom", "Asha", 5450, 3, "2026-09-05"];

  afterEach(() => vi.restoreAllMocks());

  async function run(logRows: unknown[][]) {
    const logs = captureLogs();
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: settingsGrid(),
      [LOG_TAB]: logRows,
      [TENANTS_TAB]: [[...TENANT_HEADERS]],
    });
    await ensureTabs(fake, "Schedule");
    return { fake, logs };
  }

  it("keeps a H1 that holds other text, fills a blank I1, and logs it once", async () => {
    const { fake, logs } = await run([[...first7, "Comments"], row]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([[...first7, "Comments", "Action"], row]);
    expect(loggedLines(logs.warn)).toEqual([
      expect.objectContaining({ level: "warn", event: "payments-log-header-taken", message: expect.stringContaining("H1") }),
    ]);
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("keeps an I1 that holds other text, fills a blank H1", async () => {
    const { fake, logs } = await run([[...first7, "", "Remarks"]]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([[...first7, "Logged by", "Remarks"]]);
    const [line] = loggedLines(logs.warn);
    expect(line.event).toBe("payments-log-header-taken");
    expect(String(line.message)).toContain("I1");
    expect(String(line.message)).not.toContain("H1");
  });

  it("leaves both cells alone, and says so in one log line, when both hold other text", async () => {
    const { fake, logs } = await run([[...first7, "Comments", "Remarks"], row]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([[...first7, "Comments", "Remarks"], row]);
    expect(fake.calls).not.toContain("updateValues");
    const lines = loggedLines(logs.warn);
    expect(lines).toHaveLength(1);
    expect(String(lines[0].message)).toContain("H1 and I1");
  });

  it("does not put what the cell holds in the log line", async () => {
    const { logs } = await run([[...first7, "Secret remark"]]);
    expect(JSON.stringify(loggedLines(logs.warn))).not.toContain("Secret remark");
  });

  it("compares H1 and I1 with the same looser rule: case, spacing and invisible characters do not matter", async () => {
    const header = [...first7, " logged  BY ", "Ac\u200btion"];
    const { fake, logs } = await run([header, row]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([header, row]);
    expect(fake.calls).not.toContain("updateValues");
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it("fills only the missing cell of a half-upgraded header", async () => {
    const { fake, logs } = await run([[...first7, "Logged by"]]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    expect(logs.warn).not.toHaveBeenCalled();
    const writes = fake.calls.filter((call) => call === "updateValues");
    expect(writes).toHaveLength(1);
  });

  it("still writes both headers into an old header row in one go", async () => {
    const { fake } = await run([first7, row]);
    expect(fake.tabs.get(LOG_TAB)![0]).toEqual(LOG_HEADERS);
    expect(fake.calls.filter((call) => call === "updateValues")).toHaveLength(1);
  });
});

describe("readSettings", () => {
  const withRow = (row: unknown[]) =>
    new FakeGateway({ [SETTINGS_TAB]: [["Portion"], row] });

  it("reads a blank cycle length as never resets", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", "", 5]);
    expect((await readSettings(fake))[0].cycleLength).toBeNull();
  });

  it("rejects a non-integer cycle length instead of guessing", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", 5.5, 5]);
    await expect(readSettings(fake)).rejects.toThrow(/cycle length must be a whole number/);
  });

  it("rejects a negative hike", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", 11, -1]);
    await expect(readSettings(fake)).rejects.toThrow(/hike % must be a number/);
  });
});

describe("readSettings: rows typed by hand", () => {
  const PORTION_ROW = ["p1", "Ground", "Tenant", "Count", "Amount", 11, 5];
  const withRows = (...rows: unknown[][]) =>
    new FakeGateway({ [SETTINGS_TAB]: [["Portion"], PORTION_ROW, ...rows] });
  const problemOf = async (fake: FakeGateway) => {
    const error = await readSettings(fake).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sheet-structure");
    return (error as AppError).message;
  };

  it("ignores a note typed under the table", async () => {
    const fake = withRows([], ["Remember to review the hike in November"], ["Note", "see the lease"]);
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(["p1"]);
  });

  it("ignores a row whose Tenant, Count and Amount cells hold only spaces", async () => {
    const fake = withRows(["Note", "text", " ", "  ", ""]);
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(["p1"]);
  });

  it("still ignores a row with no portion id, as before", async () => {
    const fake = withRows(["", "Ghost", "Tenant2", "Count2", "Amount2", 11, 5]);
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(["p1"]);
  });

  it("names the row when only some of Tenant, Count and Amount are filled", async () => {
    expect(await problemOf(withRows(["p2", "Two", "Tenant2", "", ""]))).toMatch(/Settings row 3\b.*Tenant.*Count.*Amount/);
    expect(await problemOf(withRows(["p2", "Two", "Tenant2", "Count2", " "]))).toMatch(/Settings row 3\b/);
    expect(await problemOf(withRows([], ["p2", "Two", "", "Count2", "Amount2"]))).toMatch(/Settings row 4\b/);
  });

  it("refuses a half-filled row even when the id cell is blank", async () => {
    expect(await problemOf(withRows(["", "Two", "Tenant2"]))).toMatch(/Settings row 3\b/);
  });

  it("accepts ids of letters, digits, - and _ up to 20 characters", async () => {
    const ids = ["p1", "A-b_9", "__proto__", "constructor", "x".repeat(20), 7];
    const rows = ids.map((id, i) => [id, `Portion ${i}`, `T${i}`, `C${i}`, `A${i}`, 11, 5]);
    const fake = new FakeGateway({ [SETTINGS_TAB]: [["Portion"], ...rows] });
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(ids.map(String));
  });

  it("keeps working when a hand-typed id has a space or line break around it", async () => {
    for (const id of ["p1 ", " p1", "p1\n", "\tp1  "]) {
      const fake = new FakeGateway({ [SETTINGS_TAB]: [["Portion"], [id, "Ground", "Tenant", "Count", "Amount", 11, 5]] });
      expect((await readSettings(fake)).map((p) => p.id)).toEqual(["p1"]);
    }
  });

  it("refuses an id with other characters or more than 20, naming the row", async () => {
    for (const id of ["p 1", "p.1", "p/1", "p\n1", "x".repeat(21), "x".repeat(20) + " y", "naïve"]) {
      const fake = new FakeGateway({
        [SETTINGS_TAB]: [["Portion"], PORTION_ROW, [id, "Two", "Tenant2", "Count2", "Amount2", 11, 5]],
      });
      expect(await problemOf(fake)).toMatch(/Settings row 3\b[\s\S]*letters, numbers/);
    }
  });

  it("cuts a very long id to 40 characters in the message", async () => {
    const id = "y".repeat(200);
    const fake = new FakeGateway({
      [SETTINGS_TAB]: [["Portion"], [id, "Two", "Tenant2", "Count2", "Amount2", 11, 5]],
    });
    const message = await problemOf(fake);
    expect(message).toContain("y".repeat(40));
    expect(message).not.toContain("y".repeat(41));
  });

  it("echoes only printable text: line breaks and control characters become spaces, the row is still named", async () => {
    const fake = new FakeGateway({
      [SETTINGS_TAB]: [["Portion"], PORTION_ROW, ["bad\r\nid\u0007!\u2028", "Two", "Tenant2", "Count2", "Amount2", 11, 5]],
    });
    const message = await problemOf(fake);
    expect(message).toMatch(/Settings row 3\b/);
    expect(message).toContain('"bad id !"');
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  });
});

describe("readSettings: two rows with the same id", () => {
  const row = (id: string, n: number) => [id, `Portion ${n}`, `Tenant${n}`, `Count${n}`, `Amount${n}`, 11, 5];
  const problemOf = async (rows: unknown[][]) => {
    const error = await readSettings(new FakeGateway({ [SETTINGS_TAB]: [["Portion"], ...rows] })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sheet-structure");
    return (error as AppError).message;
  };

  it("names both rows and the id", async () => {
    expect(await problemOf([row("p1", 1), row("p2", 2), row("p3", 3), row("p4", 4), row("p5", 5), row("p2", 6)])).toBe(
      'Settings rows 3 and 7 both use the portion id "p2". Give each portion its own id.',
    );
  });

  it("counts the real sheet rows, blank rows and notes included", async () => {
    expect(await problemOf([row("p1", 1), [], ["a note"], row("p2", 2), row("p3", 3), [], row("p2", 4)])).toBe(
      'Settings rows 5 and 8 both use the portion id "p2". Give each portion its own id.',
    );
  });

  it("compares ids without regard to capitals or the spaces around them", async () => {
    expect(await problemOf([row("p2", 1), row(" P2 ", 2)])).toBe(
      'Settings rows 2 and 3 both use the portion id "p2". Give each portion its own id.',
    );
  });

  it("is not triggered by a note row that repeats an id but has no headers", async () => {
    const fake = new FakeGateway({
      [SETTINGS_TAB]: [["Portion"], row("p1", 1), ["p1", "see the lease", "", "", ""], row("p2", 2)],
    });
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("is the same refusal for the page's read as for a write", async () => {
    const fake = new FakeGateway({ [SETTINGS_TAB]: [["Portion"], row("p1", 1), row("p1", 2)] });
    await expect(updateSettings(fake, [{ id: "p1", name: "A", cycleLength: 11, hikePercent: 5 }])).rejects.toThrow(
      /both use the portion id "p1"/,
    );
    expect(fake.calls).not.toContain("updateValues");
  });
});

describe("ensureTabs: a Settings read that comes back empty", () => {
  /** Answers the first `blanks` reads of the Settings tab with nothing, as a read that went wrong might. */
  class BlankingGateway extends FakeGateway {
    settingsReads = 0;
    constructor(
      initial: ConstructorParameters<typeof FakeGateway>[0],
      private blanks: number,
    ) {
      super(initial);
    }
    async getValues(tab: string, a1: string, render: Parameters<FakeGateway["getValues"]>[2]) {
      if (tab === SETTINGS_TAB) {
        this.settingsReads++;
        if (this.blanks > 0) {
          this.blanks--;
          return [];
        }
      }
      return super.getValues(tab, a1, render);
    }
  }

  const OWN_SETTINGS = [["Portion"], ["p1", "Ground", "Tenant", "Count", "Amount", 6, 8]];

  it("is read once more, and Settings that are there are never seeded over", async () => {
    const fake = new BlankingGateway({ Schedule: baseSchedule(), [SETTINGS_TAB]: OWN_SETTINGS }, 1);
    await ensureTabs(fake, "Schedule");
    expect(fake.settingsReads).toBe(2);
    expect(fake.tabs.get(SETTINGS_TAB)).toEqual(OWN_SETTINGS);
    expect(await readSettings(fake)).toHaveLength(1);
  });

  it("is read only once when it is not empty", async () => {
    const fake = new BlankingGateway({ Schedule: baseSchedule(), [SETTINGS_TAB]: OWN_SETTINGS }, 0);
    await ensureTabs(fake, "Schedule");
    expect(fake.settingsReads).toBe(1);
  });

  it("still seeds a Settings tab that is empty on both reads", async () => {
    const fake = new BlankingGateway({ Schedule: baseSchedule(), [SETTINGS_TAB]: [["Portion"]] }, 0);
    await ensureTabs(fake, "Schedule");
    expect(fake.settingsReads).toBe(2);
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(PORTIONS.map((p) => p.id));
  });

  it("does not read a Settings tab that is not there", async () => {
    const fake = new BlankingGateway({ Schedule: baseSchedule() }, 0);
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.has(SETTINGS_TAB)).toBe(true);
    expect((await readSettings(fake)).map((p) => p.id)).toEqual(PORTIONS.map((p) => p.id));
  });
});

describe("updateSettings", () => {
  async function seeded() {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    return fake;
  }

  it("changes name, cycle length and hike percent only", async () => {
    const fake = await seeded();
    await updateSettings(fake, [
      { id: "p3", name: " Attic ", cycleLength: null, hikePercent: 7.5 },
    ]);
    const portions = await readSettings(fake);
    expect(portions[2]).toMatchObject({
      name: "Attic",
      cycleLength: null,
      hikePercent: 7.5,
      tenantHeader: "Tenant3",
    });
    expect(portions[0].cycleLength).toBe(11);
  });

  it("writes to the row a portion really sits on, even after a blank row", async () => {
    const fake = new FakeGateway({
      [SETTINGS_TAB]: [
        ["Portion"],
        ["p1", "One", "Tenant", "Count", "Amount", 11, 5],
        [],
        ["p2", "Two", "Tenant2", "Count2", "Amount2", 11, 5],
        ["p3", "Three", "Tenant3", "Count3", "Amount3", 11, 5],
      ],
    });
    await updateSettings(fake, [{ id: "p3", name: "Attic", cycleLength: 6, hikePercent: 8 }]);
    const grid = fake.tabs.get(SETTINGS_TAB)!;
    expect(grid[4]).toEqual(["p3", "Attic", "Tenant3", "Count3", "Amount3", 6, 8]);
    expect(grid[3]).toEqual(["p2", "Two", "Tenant2", "Count2", "Amount2", 11, 5]);
    expect(grid[2]).toEqual([]);
    const portions = await readSettings(fake);
    expect(portions.map((p) => p.name)).toEqual(["One", "Two", "Attic"]);
  });

  it("rejects bad values before writing anything", async () => {
    const fake = await seeded();
    const before = JSON.stringify([...fake.tabs.get(SETTINGS_TAB)!]);
    await expect(
      updateSettings(fake, [
        { id: "p1", name: "Fine", cycleLength: 12, hikePercent: 5 },
        { id: "p2", name: "", cycleLength: 12, hikePercent: 5 },
      ]),
    ).rejects.toThrow(/Portion name/);
    // the words the screen uses for the fields, and the field (in the request's own path) so the screen can show them beside it
    await expect(
      updateSettings(fake, [{ id: "p1", name: "A", cycleLength: 0, hikePercent: 5 }]),
    ).rejects.toMatchObject({ message: "Payments per cycle must be a whole number from 1 to 120.", details: { field: "portions.0.cycleLength" } });
    await expect(
      updateSettings(fake, [
        { id: "p1", name: "A", cycleLength: 11, hikePercent: 5 },
        { id: "p2", name: "B", cycleLength: 11, hikePercent: 101 },
      ]),
    ).rejects.toMatchObject({ message: "Hike must be a number from 0 to 100.", details: { field: "portions.1.hikePercent" } });
    await expect(
      updateSettings(fake, [{ id: "zz", name: "A", cycleLength: 11, hikePercent: 5 }]),
    ).rejects.toThrow("That portion isn't in your Settings any more. Tap another tab at the bottom of the screen and come back, then check the cards.");
    expect(JSON.stringify([...fake.tabs.get(SETTINGS_TAB)!])).toBe(before);
  });
});
