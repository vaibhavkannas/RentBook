import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, tabMissing } from "@/lib/errors";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { NamedTabsGateway, tabNamesProblem, type TabNames } from "@/lib/sheets/named-tabs";
import { getMonthView, logPayment, undoPayment, type SheetsContext } from "@/lib/sheets/service";
import { ensureTabs, LOG_HEADERS, LOG_TAB, readSettings, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { moveOutTenancy, saveTenancy } from "@/lib/sheets/tenancy-service";
import { readTenancies, TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid, TOTAL_HEADER } from "../support/fixtures";

const DEFAULTS: TabNames = { schedule: "Schedule", settings: SETTINGS_TAB, log: LOG_TAB, tenants: TENANTS_TAB };
const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };
const PAY = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };
const STAMP = { now: NOW, updatedBy: "owner@example.com" };

afterEach(() => vi.restoreAllMocks());

/** A fake that fails the way the Google gateway does when a tab is not in the Sheet: with tabMissing, naming the tab. */
class GoogleLikeFake extends FakeGateway {
  private need(tab: string) {
    if (!this.tabs.has(tab)) throw tabMissing(tab);
  }
  async getValues(tab: string, a1: string, render: Parameters<FakeGateway["getValues"]>[2]) {
    this.need(tab);
    return super.getValues(tab, a1, render);
  }
  async getManyValues(requests: Parameters<FakeGateway["getManyValues"]>[0], render: Parameters<FakeGateway["getValues"]>[2]) {
    for (const { tab } of requests) this.need(tab);
    return super.getManyValues(requests, render);
  }
  async updateValues(writes: Parameters<FakeGateway["updateValues"]>[0]) {
    for (const { tab } of writes) this.need(tab);
    return super.updateValues(writes);
  }
  async appendRow(tab: string, row: unknown[]) {
    this.need(tab);
    return super.appendRow(tab, row);
  }
}

const appTabs = (extra: Record<string, unknown[][]> = {}) => ({
  Schedule: baseSchedule(),
  [SETTINGS_TAB]: settingsGrid(),
  [LOG_TAB]: [[...LOG_HEADERS]],
  [TENANTS_TAB]: [[...TENANT_HEADERS]],
  ...extra,
});

describe("with the default names the wrapper is invisible", () => {
  /** The same work, through the wrapper or straight at the fake, and everything that happened to the fake. */
  async function session(wrapped: boolean, start: Record<string, unknown[][]>) {
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as ReturnType<typeof crypto.randomUUID>,
    );
    const fake = new FakeGateway(start);
    const gateway: SheetsGateway = wrapped ? new NamedTabsGateway(fake, DEFAULTS) : fake;
    const ctx: SheetsContext = { gateway, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };

    await getMonthView(ctx, OCT);
    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, PAY);
    await logPayment(ctx, { month: OCT, portionId: "p2", amount: 13300, dateReceived: "2026-10-05" }, PAY);
    // an edit: replace p1's amount, saying what was on screen
    await logPayment(
      ctx,
      {
        month: OCT,
        portionId: "p1",
        amount: 5600,
        dateReceived: "2026-10-06",
        overwrite: true,
        expected: { tenant: "Asha", count: 4, amount: 5450 },
      },
      PAY,
    );
    await undoPayment(ctx, { month: OCT, portionId: "p2", expected: { tenant: "Bala", count: 1, amount: 13300 } }, PAY);
    // a new tenant with details, then an edit of the details, then a move-out
    await logPayment(
      ctx,
      {
        month: OCT,
        portionId: "p4",
        amount: 8800,
        dateReceived: "2026-10-07",
        newTenantName: "Dev",
        tenancy: {
          phone: "98765 43210",
          moveIn: "2026-10-01",
          agreementEnd: "",
          advance: 20000,
          advanceDate: "2026-10-01",
          notes: "",
        },
      },
      PAY,
    );
    const { tenancy } = await saveTenancy(
      ctx,
      {
        portionId: "p1",
        tenant: "Asha",
        fields: { phone: "", moveIn: "2026-01-15", agreementEnd: "", advance: null, advanceDate: "", notes: "" },
      },
      STAMP,
    );
    await saveTenancy(
      ctx,
      {
        portionId: "p1",
        tenant: "Asha",
        id: tenancy.id,
        expectedUpdatedAt: tenancy.updatedAt,
        fields: { phone: "98765 43210", moveIn: "2026-01-15", agreementEnd: "", advance: null, advanceDate: "", notes: "Edited" },
      },
      { now: new Date("2026-10-06T09:00:00Z"), updatedBy: "member@example.com" },
    );
    const [open] = (await readTenancies(gateway)).filter((t) => t.portionId === "p1");
    await moveOutTenancy(
      ctx,
      { id: open.id, expectedUpdatedAt: open.updatedAt, moveOut: "2026-10-30" },
      { now: new Date("2026-10-07T09:00:00Z"), updatedBy: "owner@example.com" },
    );
    await readSettings(gateway);

    return {
      calls: fake.calls,
      tabNames: [...fake.tabs.keys()],
      grids: structuredClone([...fake.tabs.entries()]),
    };
  }

  it("makes the same Google calls, on the same tabs, with the same result, from a Sheet that has every tab", async () => {
    const bare = await session(false, appTabs());
    vi.restoreAllMocks();
    const wrapped = await session(true, appTabs());
    expect(bare.calls.length).toBeGreaterThan(40);
    expect(wrapped.calls).toEqual(bare.calls);
    expect(wrapped.tabNames).toEqual(bare.tabNames);
    expect(wrapped.grids).toEqual(bare.grids);
  });

  it("makes the same Google calls, with the same result, from a Sheet that has only the Schedule: the app tabs are created", async () => {
    const bare = await session(false, { Schedule: baseSchedule() });
    vi.restoreAllMocks();
    const wrapped = await session(true, { Schedule: baseSchedule() });
    expect(bare.tabNames).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB, TENANTS_TAB]);
    expect(wrapped.calls).toEqual(bare.calls);
    expect(wrapped.tabNames).toEqual(bare.tabNames);
    expect(wrapped.grids).toEqual(bare.grids);
  });

  it("asks for the tab list once, for ensureTabs: it builds its map from that answer", async () => {
    const fake = new FakeGateway(appTabs());
    const gateway = new NamedTabsGateway(fake, DEFAULTS);
    await ensureTabs(gateway, "Schedule");
    await gateway.getValues("Tenants", "A1:O", "UNFORMATTED_VALUE");
    expect(fake.calls.filter((call) => call === "listTabs")).toHaveLength(1);
  });
});

describe("finding a real tab", () => {
  const wrap = (tabs: Record<string, unknown[][]>, names: Partial<TabNames> = {}) => {
    const fake = new FakeGateway(tabs);
    return { fake, gateway: new NamedTabsGateway(fake, { ...DEFAULTS, ...names }) };
  };

  it("finds 'schedule' for the name 'Schedule', and the app keeps calling it 'Schedule'", async () => {
    const { fake, gateway } = wrap({ schedule: baseSchedule() });
    expect(await gateway.listTabs()).toEqual(["Schedule"]);
    const rows = await gateway.getValues("Schedule", "A1:A", "UNFORMATTED_VALUE");
    expect(rows[3]).toEqual(["Aug-26"]);
    expect(fake.calls).toEqual(["listTabs", "getValues"]);
  });

  it("finds a tab whose name differs by spaces, capitals or invisible characters", async () => {
    const { gateway } = wrap({ "  PAYMENTS  log ": [["x"]] });
    expect(await gateway.listTabs()).toEqual(["Payments Log"]);
    expect(await gateway.getValues("Payments Log", "A1", "UNFORMATTED_VALUE")).toEqual([["x"]]);
  });

  it("prefers the tab whose name is exactly the configured one over a look-alike", async () => {
    const { gateway } = wrap({ schedule: [["lower"]], Schedule: [["exact"]] });
    expect(await gateway.getValues("Schedule", "A1", "UNFORMATTED_VALUE")).toEqual([["exact"]]);
    expect(await gateway.listTabs()).toEqual(["schedule", "Schedule"]);
  });

  it("counts two look-alikes as no tab: it never guesses", async () => {
    const { gateway } = wrap({ schedule: [["a"]], SCHEDULE: [["b"]], Other: [] });
    expect(await gateway.listTabs()).toEqual(["schedule", "SCHEDULE", "Other"]);
    await expect(ensureTabs(gateway, "Schedule")).rejects.toThrow(/The tab "Schedule" was not found/);
  });

  it("passes other tabs, and names it does not know, through as they are", async () => {
    const { fake, gateway } = wrap({ Schedule: [["s"]], "My notes": [["n"]] });
    expect(await gateway.listTabs()).toEqual(["Schedule", "My notes"]);
    expect(await gateway.getValues("My notes", "A1", "UNFORMATTED_VALUE")).toEqual([["n"]]);
    await gateway.addTab("Scratch");
    await gateway.appendRow("Scratch", ["x"]);
    expect(fake.tabs.get("Scratch")).toEqual([["x"]]);
  });
});

describe("TENANTS_TAB points at another tab", () => {
  const NAMES: TabNames = { ...DEFAULTS, tenants: "RentBook Tenants" };
  const THEIRS = [["Name", "Flat"], ["Asha", "1F"]];

  it("lists 'RentBook Tenants' as Tenants, and leaves the owner's own Tenants tab out of the list", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), Tenants: THEIRS, "RentBook Tenants": [[...TENANT_HEADERS]], Notes: [] });
    const gateway = new NamedTabsGateway(fake, NAMES);
    expect(await gateway.listTabs()).toEqual(["Schedule", "Tenants", "Notes"]);
  });

  it("lists no Tenants tab at all while only the owner's own exists, so the app creates its own", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), Tenants: THEIRS });
    expect(await new NamedTabsGateway(fake, NAMES).listTabs()).toEqual(["Schedule"]);
  });

  it("maps every method to the real tab and never to the owner's", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      Tenants: THEIRS,
      "RentBook Tenants": [[...TENANT_HEADERS]],
    });
    const gateway = new NamedTabsGateway(fake, NAMES);
    await gateway.listTabs();
    await gateway.appendRow("Tenants", ["t-1", "p1", "Asha"]);
    await gateway.updateValues([{ tab: "Tenants", a1: "D2", values: [["98765 43210"]] }]);
    expect(await gateway.getValues("Tenants", "A1:D2", "UNFORMATTED_VALUE")).toEqual([
      TENANT_HEADERS.slice(0, 4),
      ["t-1", "p1", "Asha", "98765 43210"],
    ]);
    expect(await gateway.getManyValues([{ tab: "Tenants", a1: "A2:B2" }, { tab: "Schedule", a1: "A4" }], "UNFORMATTED_VALUE")).toEqual([
      [["t-1", "p1"]],
      [["Aug-26"]],
    ]);
    expect(fake.tabs.get("Tenants")).toEqual(THEIRS);
    expect(fake.tabs.get("RentBook Tenants")![1]).toEqual(["t-1", "p1", "Asha", "98765 43210"]);
  });

  it("makes ensureTabs create 'RentBook Tenants' with the headers, and never touch 'Tenants'", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: settingsGrid(),
      [LOG_TAB]: [[...LOG_HEADERS]],
      Tenants: structuredClone(THEIRS),
    });
    const gateway = new NamedTabsGateway(fake, NAMES);
    await ensureTabs(gateway, "Schedule");
    expect([...fake.tabs.keys()]).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB, "Tenants", "RentBook Tenants"]);
    expect(fake.tabs.get("RentBook Tenants")).toEqual([TENANT_HEADERS]);
    expect(fake.tabs.get("Tenants")).toEqual(THEIRS);
    // and the app finds the tab it made, under its own name
    expect(await gateway.listTabs()).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB, TENANTS_TAB]);
  });

  it("runs the whole app on a fake that has the owner's Tenants tab, leaving it exactly as it was", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), Tenants: structuredClone(THEIRS) });
    const ctx: SheetsContext = { gateway: new NamedTabsGateway(fake, NAMES), scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
    await logPayment(
      ctx,
      {
        month: OCT,
        portionId: "p4",
        amount: 8800,
        dateReceived: "2026-10-07",
        newTenantName: "Dev",
        tenancy: { phone: "", moveIn: "2026-10-01", agreementEnd: "", advance: null, advanceDate: "", notes: "" },
      },
      PAY,
    );
    expect(fake.tabs.get("Tenants")).toEqual(THEIRS);
    const ours = fake.tabs.get("RentBook Tenants")!;
    expect(ours[0]).toEqual(TENANT_HEADERS);
    expect(ours[1][2]).toBe("Dev");
  });

  it("passes a differently written 'tenants' through as the owner's own tab", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule(), tenants: THEIRS, "RentBook Tenants": [[...TENANT_HEADERS]] });
    const gateway = new NamedTabsGateway(fake, NAMES);
    expect(await gateway.listTabs()).toEqual(["Schedule", "tenants", TENANTS_TAB]);
    expect(await gateway.getValues(TENANTS_TAB, "A1:B1", "UNFORMATTED_VALUE")).toEqual([TENANT_HEADERS.slice(0, 2)]);
  });
});

describe("a tab that goes missing", () => {
  it("forgets what it knew and resets the wrapper's own bootstrap, so the next ensureTabs looks at the Sheet again", async () => {
    const fake = new GoogleLikeFake(appTabs());
    const gateway = new NamedTabsGateway(fake, DEFAULTS);
    await ensureTabs(gateway, "Schedule");
    const listed = () => fake.calls.filter((call) => call === "listTabs").length;
    expect(listed()).toBe(1);
    await ensureTabs(gateway, "Schedule");
    expect(listed()).toBe(1); // bootstrapped: nothing was asked

    // The owner renames the Tenants tab while the app runs.
    const grid = fake.tabs.get(TENANTS_TAB)!;
    fake.tabs.delete(TENANTS_TAB);
    fake.tabs.set("tenants", grid);

    const error = await gateway.getValues("Tenants", "A1:O", "UNFORMATTED_VALUE").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toEqual({ tab: "Tenants" });

    await ensureTabs(gateway, "Schedule");
    expect(listed()).toBe(2); // the bootstrap was reset
    expect(await gateway.getValues("Tenants", "A1:O", "UNFORMATTED_VALUE")).toEqual([TENANT_HEADERS]);
  });

  it.each([
    ["appendRow", (gateway: NamedTabsGateway) => gateway.appendRow(LOG_TAB, ["x"])],
    ["updateValues", (gateway: NamedTabsGateway) => gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [["x"]] }])],
    ["getManyValues", (gateway: NamedTabsGateway) => gateway.getManyValues([{ tab: LOG_TAB, a1: "A1" }], "UNFORMATTED_VALUE")],
  ])("is reset by the missing tab that %s names, and passes the error on unchanged", async (_method, call) => {
    const fake = new GoogleLikeFake(appTabs());
    const gateway = new NamedTabsGateway(fake, DEFAULTS);
    await ensureTabs(gateway, "Schedule");
    const listed = () => fake.calls.filter((c) => c === "listTabs").length;
    fake.tabs.delete(LOG_TAB);

    const error = await call(gateway).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AppError).message).toBe(
      'The tab "Payments Log" was not found in your Sheet. Restore it from File > Version history or rename it back.',
    );
    const before = listed();
    await ensureTabs(gateway, "Schedule");
    expect(listed()).toBe(before + 1);
    expect(fake.tabs.has(LOG_TAB)).toBe(true); // the tab check ran again, and put the Payments Log back
  });

  it("does not reset on an error that names no tab", async () => {
    const fake = new FakeGateway(appTabs());
    const gateway = new NamedTabsGateway(fake, DEFAULTS);
    await ensureTabs(gateway, "Schedule");
    fake.failOn.add("appendRow");
    await expect(gateway.appendRow(LOG_TAB, ["x"])).rejects.toThrow("appendRow failed");
    fake.failOn.clear();
    const before = fake.calls.filter((c) => c === "listTabs").length;
    await ensureTabs(gateway, "Schedule");
    expect(fake.calls.filter((c) => c === "listTabs").length).toBe(before);
  });
});

describe("realTitles", () => {
  it("gives the real name of each tab, or null where there is none", async () => {
    const fake = new FakeGateway({ schedule: [], "RentBook Tenants": [], Settings: [] });
    const gateway = new NamedTabsGateway(fake, { ...DEFAULTS, tenants: "RentBook Tenants" });
    expect(await gateway.realTitles()).toEqual({
      schedule: "schedule",
      settings: "Settings",
      log: null,
      tenants: "RentBook Tenants",
    });
  });

  it("reads the Sheet again each time, so a setup page shows what is there now", async () => {
    const fake = new FakeGateway({ Schedule: [] });
    const gateway = new NamedTabsGateway(fake, DEFAULTS);
    expect((await gateway.realTitles()).log).toBeNull();
    fake.tabs.set("payments log", []);
    expect((await gateway.realTitles()).log).toBe("payments log");
  });
});

describe("configuredTabName", () => {
  it("gives the name the owner asked for an app tab, and the app's own name for a name it does not know", () => {
    const gateway = new NamedTabsGateway(new FakeGateway({}), { ...DEFAULTS, settings: "My Settings", tenants: "RentBook Tenants" });
    expect(gateway.configuredTabName(SETTINGS_TAB)).toBe("My Settings");
    expect(gateway.configuredTabName(LOG_TAB)).toBe(LOG_TAB);
    expect(gateway.configuredTabName(TENANTS_TAB)).toBe("RentBook Tenants");
    expect(gateway.configuredTabName("Schedule")).toBe("Schedule");
    expect(gateway.configuredTabName("Something else")).toBe("Something else");
  });
});

describe("a Settings tab that is not there, under a name of the owner's own", () => {
  const SETTINGS_MISSING_DEFAULT =
    "The Settings tab is missing. Restore it from File > Version history or rename it back. RentBook will not recreate it because that would reset your rent cycle lengths and hike percentages.";

  async function refusal(names: Partial<TabNames>, tabs: Record<string, unknown[][]>): Promise<AppError> {
    const gateway = new NamedTabsGateway(new FakeGateway(tabs), { ...DEFAULTS, ...names });
    const error = await ensureTabs(gateway, "Schedule").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }

  it("is named in the refusal, so the owner knows which tab to restore or rename back", async () => {
    const error = await refusal({ settings: "My Settings" }, { Schedule: baseSchedule(), [LOG_TAB]: [[...LOG_HEADERS]] });
    expect(error.code).toBe("sheet-structure");
    expect(error.message).toBe(
      'The Settings tab, "My Settings", is missing. Restore it from File > Version history or rename it back. RentBook will not recreate it because that would reset your rent cycle lengths and hike percentages.',
    );
  });

  it("is told as before when the tab has its usual name, through the wrapper and without it", async () => {
    const tabs = { Schedule: baseSchedule(), [TENANTS_TAB]: [[...TENANT_HEADERS]] };
    expect((await refusal({}, tabs)).message).toBe(SETTINGS_MISSING_DEFAULT);
    const bare = await ensureTabs(new FakeGateway(tabs), "Schedule").then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(bare?.message).toBe(SETTINGS_MISSING_DEFAULT);
  });

  it("is named by its configured name even when a tab with the app's own name is in the Sheet", async () => {
    // "Settings" is somebody's own tab: SETTINGS_TAB points elsewhere, so it is not ours and is not listed.
    const error = await refusal(
      { settings: "My Settings" },
      { Schedule: baseSchedule(), [SETTINGS_TAB]: [["the owner's own notes"]], [LOG_TAB]: [[...LOG_HEADERS]] },
    );
    expect(error.message).toContain('"My Settings"');
  });
});

describe("tabNamesProblem", () => {
  it("is null for the four default names and for four names that differ", () => {
    expect(tabNamesProblem(DEFAULTS)).toBeNull();
    expect(tabNamesProblem({ schedule: "Rent", settings: "Rent Settings", log: "Rent Log", tenants: "Rent Tenants" })).toBeNull();
  });

  it("says the four must each name a different tab when two match by headerKey", () => {
    const said = "SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB and TENANTS_TAB must each name a different tab.";
    expect(tabNamesProblem({ ...DEFAULTS, tenants: "Schedule" })).toBe(said);
    expect(tabNamesProblem({ ...DEFAULTS, tenants: " schedule " })).toBe(said);
    expect(tabNamesProblem({ ...DEFAULTS, log: "settings" })).toBe(said);
    expect(tabNamesProblem({ ...DEFAULTS, log: "Sett​ings" })).toBe(said);
    expect(tabNamesProblem({ ...DEFAULTS, settings: "Payments  Log" })).toBe(said);
  });

  it("refuses a Schedule named like one of the app's own tabs when that app tab has been given another name", () => {
    expect(tabNamesProblem({ ...DEFAULTS, schedule: "Tenants", tenants: "RentBook Tenants" })).toMatch(/SCHEDULE_TAB can't be "Tenants"/);
    expect(tabNamesProblem({ ...DEFAULTS, schedule: "payments log", log: "Rent Log" })).toMatch(/SCHEDULE_TAB can't be/);
  });
});

describe("the constructor", () => {
  it("refuses names that cannot be told apart, rather than map two tabs to one", () => {
    expect(() => new NamedTabsGateway(new FakeGateway(), { ...DEFAULTS, tenants: "schedule" })).toThrow(
      "SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB and TENANTS_TAB must each name a different tab.",
    );
  });
});
