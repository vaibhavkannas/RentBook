import { describe, expect, it } from "vitest";
import { deriveMonthView } from "@/lib/domain/month-view";
import { addDays, addMonths, currentYm, firstDayOf, todayIso } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { indiaDayKey } from "@/lib/format";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { loadSnapshot, readActivity, type SheetsContext } from "@/lib/sheets/service";
import { parseTenancyLog } from "@/lib/sheets/tenancy-log-store";
import { FakeGateway } from "./fake-gateway";
import { TOTAL_HEADER } from "./fixtures";
import { faults, LONG_PORTION, LONG_TENANT, MEMBER_EMAIL, OWNER_EMAIL, world, withFaults, type WorldName } from "./worlds";

const DAYS = {
  "this year": new Date("2026-10-17T06:30:00Z"),
  "the year rolling over": new Date("2027-01-03T06:30:00Z"),
  "the 1st": new Date("2026-03-01T06:30:00Z"),
  // 19:30 UTC on 28 February is already 01:00 on 1 March in India.
  "just after midnight in India": new Date("2026-02-28T19:30:00Z"),
} as const;

const contextOf = (gateway: SheetsGateway): SheetsContext => ({ gateway, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });
const gatewayFor = (name: WorldName, now: Date) => new FakeGateway(world(name, now).tabs);

describe.each(Object.entries(DAYS))("the worlds on %s", (_label, now) => {
  const month = currentYm(now);

  it.each(["main", "empty", "fresh", "long"] as const)("%s: every tab is read with no problem", async (name) => {
    const fake = gatewayFor(name, now);
    const snapshot = await loadSnapshot(contextOf(fake));
    expect(snapshot.tenantsProblem).toBeUndefined();
    expect(snapshot.portions.map((portion) => portion.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(snapshot.rows).toHaveLength(name === "empty" ? 1 : 3);
    expect(snapshot.tenancies).toHaveLength(name === "main" || name === "long" ? 4 : 0);
  });

  it("main's Schedule holds the three months of the table, and the entries in them", async () => {
    const { rows } = await loadSnapshot(contextOf(gatewayFor("main", now)));
    expect(rows.map((row) => row.month)).toEqual([addMonths(month, -2), addMonths(month, -1), month]);
    const shown = (row: (typeof rows)[number]) =>
      ["p1", "p2", "p3", "p4", "p5"].map((id) => {
        const entry = row.entries.get(id);
        return entry ? `${entry.tenant} ${entry.count} ${entry.amount}` : null;
      });
    expect(rows.map(shown)).toEqual([
      ["Asha 2 5450", "Bala 10 12700", "Chitra 4 9000", null, "Esha 1 5100"],
      ["Asha 3 5450", "Bala 11 12700", null, null, "Esha 2 5100"],
      ["Asha 4 5450", null, null, null, null],
    ]);
  });

  it("main shows the statuses the table says: M-2, M-1 and M", async () => {
    const snapshot = await loadSnapshot(contextOf(gatewayFor("main", now)));
    const statuses = (offset: number) =>
      deriveMonthView(snapshot.rows, snapshot.portions, addMonths(month, offset), snapshot.tenancies).cards.map((card) => card.status);
    expect(statuses(-2)).toEqual(["paid", "paid", "paid", "needs-tenant", "paid"]);
    expect(statuses(-1)).toEqual(["paid", "paid", "pending", "needs-tenant", "paid"]);
    expect(statuses(0)).toEqual(["paid", "pending", "pending", "needs-tenant", "vacant"]);
  });

  it("main asks for the hiked rent from p2 and the old rent from p3 in M", async () => {
    const snapshot = await loadSnapshot(contextOf(gatewayFor("main", now)));
    const { cards } = deriveMonthView(snapshot.rows, snapshot.portions, month, snapshot.tenancies);
    expect(cards[0].entry).toEqual({ tenant: "Asha", count: 4, amount: 5450 });
    expect(cards[1].next).toMatchObject({ tenant: "Bala", count: 1, suggestedAmount: 13335, startsNewCycle: true });
    expect(cards[2].next).toMatchObject({ tenant: "Chitra", count: 5, suggestedAmount: 9000 });
  });

  it("main has p5 vacant since the 1st of M, even on the 1st", async () => {
    const snapshot = await loadSnapshot(contextOf(gatewayFor("main", now)));
    const card = deriveMonthView(snapshot.rows, snapshot.portions, month, snapshot.tenancies).cards[4];
    expect(card.status).toBe("vacant");
    expect(card.vacancy).toEqual({ since: firstDayOf(month), previousTenant: "Esha" });
  });

  it("main has its tenants as the table says", async () => {
    const snapshot = await loadSnapshot(contextOf(gatewayFor("main", now)));
    const today = todayIso(now);
    expect(snapshot.tenancies.map((t) => [t.portionId, t.tenant, t.agreementEnd, t.moveOut])).toEqual([
      ["p1", "Asha", addDays(today, 30), ""],
      ["p2", "Bala", "", ""],
      ["p3", "Chitra", addDays(today, -7), ""],
      ["p5", "Esha", "", firstDayOf(month)],
    ]);
  });

  it("main's Payments Log falls on the right India days: eight rows from 0 to 3 days ago, and one a year old", async () => {
    const tab = world("main", now).tabs["Payments Log"];
    const today = todayIso(now);
    const days = tab.slice(1).map((row) => indiaDayKey(String(row[0])));
    expect(days).toEqual([-365, -3, -3, -2, -2, -1, -1, 0, 0].map((back) => addDays(today, back)));
    const items = await readActivity(contextOf(gatewayFor("main", now)));
    expect(items).toHaveLength(9);
    // Newest first, as the Activity page reads them.
    expect(items[0]).toMatchObject({ action: "Edited", loggedBy: MEMBER_EMAIL });
    expect(new Set(items.map((item) => item.action))).toEqual(new Set(["Logged", "Edited", "Undone"]));
    expect(new Set(items.map((item) => item.loggedBy))).toEqual(new Set([OWNER_EMAIL, MEMBER_EMAIL]));
  });

  it("main's Tenancy Log reads with no problem: Added p1, Edited p1 (Phone, Agreement end), Moved out p5", () => {
    const { items, problem } = parseTenancyLog(world("main", now).tabs["Tenancy Log"]);
    expect(problem).toBeUndefined();
    expect(items.map((item) => [item.portionId, item.action, item.field])).toEqual([
      ["p1", "Added", ""],
      ["p1", "Edited", "Phone"],
      ["p1", "Edited", "Agreement end"],
      ["p5", "Moved out", "Move-out date"],
    ]);
  });
});

describe("the worlds", () => {
  const now = DAYS["this year"];

  it("make new tabs every time, so a test may change what it gets", () => {
    const first = world("main", now);
    first.tabs.Settings[1][1] = "changed";
    expect(world("main", now).tabs.Settings[1][1]).toBe("First floor, single bedroom");
  });

  it("empty has every app tab with its headers only, and the Schedule's header with this month's row and no payment", async () => {
    const { tabs } = world("empty", now);
    expect(Object.keys(tabs)).toEqual(["Schedule", "Settings", "Payments Log", "Tenants", "Tenancy Log"]);
    expect(tabs.Schedule).toHaveLength(4);
    expect(tabs.Schedule[3][0]).toBe("Oct-26");
    for (const tab of ["Settings", "Payments Log", "Tenants", "Tenancy Log"]) expect(tabs[tab]).toHaveLength(1);
    const snapshot = await loadSnapshot(contextOf(new FakeGateway(tabs)));
    expect(snapshot.rows.flatMap((row) => [...row.entries.values()]).filter(Boolean)).toEqual([]);
  });

  it("a Schedule with its header and no month row at all is refused by the app, so it is not what a quiet Sheet is", async () => {
    const { tabs } = world("empty", now);
    tabs.Schedule = tabs.Schedule.slice(0, 3);
    await expect(loadSnapshot(contextOf(new FakeGateway(tabs)))).rejects.toThrow("The Schedule tab has no month rows yet. Type this month's row, with each portion's tenant, count and amount, then try again.");
  });

  it("fresh has only the Schedule tab of main", () => {
    const { tabs } = world("fresh", now);
    expect(Object.keys(tabs)).toEqual(["Schedule"]);
    expect(tabs.Schedule).toEqual(world("main", now).tabs.Schedule);
  });

  it("long has the longest name the app takes, in one piece, for p1 and for Asha, wherever each is written", () => {
    expect(LONG_TENANT).toHaveLength(60);
    expect(LONG_PORTION).toHaveLength(60);
    expect(LONG_TENANT).not.toMatch(/\s/);
    expect(LONG_PORTION).not.toMatch(/\s/);
    const { tabs } = world("long", now);
    expect(tabs.Settings[1][1]).toBe(LONG_PORTION);
    expect(tabs.Schedule.slice(3).map((row) => row[1])).toEqual([LONG_TENANT, LONG_TENANT, LONG_TENANT]);
    expect(tabs.Tenants[1][2]).toBe(LONG_TENANT);
    expect(tabs["Payments Log"].filter((row) => row[3] === LONG_TENANT).length).toBeGreaterThan(0);
    expect(tabs["Payments Log"].filter((row) => row[2] === LONG_PORTION).length).toBeGreaterThan(0);
    expect(JSON.stringify(world("main", now).tabs)).not.toContain(LONG_TENANT);
  });

  it("use example.com addresses only", () => {
    for (const name of ["main", "empty", "fresh", "long"] as const) {
      const emails = JSON.stringify(world(name, now).tabs).match(/[\w.+-]+@[\w.-]+/g) ?? [];
      for (const email of emails) expect(email).toMatch(/@example\.com$/);
    }
  });
});

describe("withFaults", () => {
  const inner = () => new FakeGateway({ Schedule: [["Month"]] });

  const failure = (call: () => Promise<unknown>) =>
    call().then(
      () => null,
      (error: unknown) => error,
    );

  it("does what the gateway does while nothing is listed", async () => {
    const gateway = withFaults(inner(), faults());
    expect(await gateway.listTabs()).toEqual(["Schedule"]);
    expect(await gateway.getValues("Schedule", "A1", "UNFORMATTED_VALUE")).toEqual([["Month"]]);
  });

  it.each([
    ["unavailable", "unavailable", "Google isn't responding. Try again in a minute."],
    ["rate-limited", "rate-limited", "Google is limiting requests right now. Wait a minute and try again."],
    ["config", "config", "Google could not find that Sheet. Check SHEET_ID."],
  ] as const)("%s: a listed method fails with Google's own kind of error", async (fault, code, message) => {
    const error = await failure(() => withFaults(inner(), faults({ getManyValues: fault })).getManyValues([], "UNFORMATTED_VALUE"));
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code, message });
  });

  it("error: a listed method fails with a plain error, which is not one of the app's own", async () => {
    const error = await failure(() => withFaults(inner(), faults({ listTabs: "error" })).listTabs());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
  });

  it("fails only the methods that are listed, and none of them reaches the gateway", async () => {
    const fake = inner();
    const gateway = withFaults(fake, faults({ getManyValues: "unavailable" }));
    expect(await failure(() => gateway.getManyValues([], "UNFORMATTED_VALUE"))).toBeInstanceOf(AppError);
    expect(await gateway.listTabs()).toEqual(["Schedule"]);
    expect(fake.calls).toEqual(["listTabs"]);
  });

  it("can fail every method of the gateway", async () => {
    const all = faults({
      listTabs: "unavailable", addTab: "unavailable", getValues: "unavailable", getManyValues: "unavailable", updateValues: "unavailable",
      appendRow: "unavailable", appendRows: "unavailable", ensureColumnCount: "unavailable", cloneRow: "unavailable",
    });
    const gateway = withFaults(inner(), all);
    for (const call of [
      () => gateway.listTabs(),
      () => gateway.addTab("x"),
      () => gateway.getValues("Schedule", "A1", "FORMULA"),
      () => gateway.getManyValues([], "FORMULA"),
      () => gateway.updateValues([]),
      () => gateway.appendRow("Schedule", []),
      () => gateway.appendRows("Schedule", []),
      () => gateway.ensureColumnCount("Schedule", 3),
      () => gateway.cloneRow("Schedule", 1, 2, [], []),
    ]) {
      expect(await failure(call)).toMatchObject({ code: "unavailable" });
    }
  });

  it("reads the faults on every call, so a test can switch one on and off", async () => {
    const set = faults();
    const gateway = withFaults(inner(), set);
    expect(await gateway.listTabs()).toEqual(["Schedule"]);
    set.listTabs = "rate-limited";
    expect(await failure(() => gateway.listTabs())).toMatchObject({ code: "rate-limited" });
    delete set.listTabs;
    expect(await gateway.listTabs()).toEqual(["Schedule"]);
  });

  it("faults() makes a new, empty set each time, or a copy of the one it is given", () => {
    expect(faults()).toEqual({});
    expect(faults()).not.toBe(faults());
    const given = { listTabs: "error" } as const;
    expect(faults(given)).toEqual(given);
    expect(faults(given)).not.toBe(given);
  });
});
