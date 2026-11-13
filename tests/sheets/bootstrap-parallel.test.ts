import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import { loadSnapshot, type SheetsContext } from "@/lib/sheets/service";
import { ensureTabs, LOG_HEADERS, LOG_TAB, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { TENANCY_LOG_HEADERS, TENANCY_LOG_TAB } from "@/lib/sheets/tenancy-log-store";
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import type { TabNames } from "@/lib/sheets/tab-names";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid, TOTAL_HEADER } from "../support/fixtures";
import { withFaults, faults } from "../support/worlds";
import { captureLogs, loggedLines } from "../support/logs";

// The first page view of a cold server runs the tab checks before it reads the Sheet. Their reads do not depend on each other, so
// they are asked for together: the same calls, the same ranges, the same writes in the same order, in fewer waits.

afterEach(() => vi.restoreAllMocks());

const allTabs = () => ({
  Schedule: baseSchedule(),
  [SETTINGS_TAB]: settingsGrid(),
  [LOG_TAB]: [[...LOG_HEADERS]],
  [TENANTS_TAB]: [[...TENANT_HEADERS]],
  [TENANCY_LOG_TAB]: [[...TENANCY_LOG_HEADERS]],
});

/** Wraps a gateway to count how many calls are in the air at once, and how many separate waits a run made (a wait: a call started while none was in flight). */
function watched(inner: SheetsGateway) {
  let inFlight = 0;
  const seen = { peak: 0, waits: 0, order: [] as string[] };
  const wrapped: Record<string, unknown> = {};
  for (const method of ["listTabs", "addTab", "getValues", "getManyValues", "updateValues", "appendRow", "appendRows", "ensureColumnCount", "cloneRow"] as const) {
    wrapped[method] = async (...args: unknown[]) => {
      if (inFlight === 0) seen.waits += 1;
      inFlight += 1;
      seen.peak = Math.max(seen.peak, inFlight);
      seen.order.push(method);
      try {
        return await (inner[method] as (...a: unknown[]) => Promise<unknown>).apply(inner, args);
      } finally {
        inFlight -= 1;
      }
    };
  }
  return { gateway: wrapped as unknown as SheetsGateway, seen };
}

const context = (gateway: SheetsGateway): SheetsContext => ({ gateway, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER });

describe("a cold start", () => {
  it("makes the same calls as before, but asks for the four header reads together: three waits instead of six", async () => {
    const fake = new FakeGateway(allTabs(), { delayMs: 5 });
    const { gateway, seen } = watched(fake);
    await loadSnapshot(context(gateway));
    expect(seen.order).toEqual(["listTabs", "getValues", "getValues", "getValues", "getValues", "getManyValues"]);
    expect(seen.peak).toBe(4);
    // the tab list, then the four reads, then the snapshot
    expect(seen.waits).toBe(3);
  });

  it("reads the ranges each check always read", async () => {
    const fake = new FakeGateway(allTabs());
    const asked: string[] = [];
    const original = fake.getValues.bind(fake);
    fake.getValues = async (tab, a1, render) => {
      asked.push(`${tab}!${a1} ${render}`);
      return original(tab, a1, render);
    };
    await ensureTabs(fake, "Schedule");
    expect(asked.sort()).toEqual(
      [
        `${SETTINGS_TAB}!A1:H50 UNFORMATTED_VALUE`,
        `${LOG_TAB}!A1:I1 FORMATTED_VALUE`,
        `${TENANTS_TAB}!A1:O1 FORMATTED_VALUE`,
        `${TENANCY_LOG_TAB}!A1:H1 FORMATTED_VALUE`,
      ].sort(),
    );
  });

  it("writes nothing to a Sheet whose tabs and headers are all right", async () => {
    const fake = new FakeGateway(allTabs());
    const before = structuredClone([...fake.tabs.entries()]);
    expect(await ensureTabs(fake, "Schedule")).toEqual({ created: [], filled: [] });
    expect([...fake.tabs.entries()]).toEqual(before);
    expect(fake.calls.filter((c) => ["addTab", "updateValues", "appendRow", "appendRows", "cloneRow"].includes(c))).toEqual([]);
  });

  it("still creates a missing Tenancy Log tab, once, with its headers, and nothing else is written", async () => {
    const tabs = allTabs();
    delete (tabs as Record<string, unknown>)[TENANCY_LOG_TAB];
    const fake = new FakeGateway(tabs);
    const { gateway, seen } = watched(fake);
    expect(await ensureTabs(gateway, "Schedule")).toEqual({ created: [TENANCY_LOG_TAB], filled: [] });
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS]);
    // the creation comes after the reads, one step after another: a tab, then its headers
    expect(seen.order.slice(-2)).toEqual(["addTab", "updateValues"]);
    expect(seen.order.filter((c) => c === "addTab")).toHaveLength(1);
  });

  it("keeps the Tenancy Log non-fatal: its failing read is logged by its own check and the rest goes on", async () => {
    const logs = captureLogs();
    class BrokenTenancyLog extends FakeGateway {
      async getValues(tab: string, a1: string, render: Parameters<FakeGateway["getValues"]>[2]) {
        if (tab === TENANCY_LOG_TAB) throw new Error("Google hiccup");
        return super.getValues(tab, a1, render);
      }
    }
    const fake = new BrokenTenancyLog(allTabs());
    await expect(ensureTabs(fake, "Schedule")).resolves.toEqual({ created: [], filled: [] });
    expect(loggedLines(logs.warn).map((line) => line.event)).toEqual(["tenancy-log-tab-failed"]);
  });

  it("refuses a missing Settings tab, with the others there, in the same words and without writing", async () => {
    const tabs = allTabs();
    delete (tabs as Record<string, unknown>)[SETTINGS_TAB];
    const fake = new FakeGateway(tabs);
    const error = await ensureTabs(fake, "Schedule").then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toContain("The Settings tab is missing");
    expect(fake.calls.filter((c) => ["addTab", "updateValues"].includes(c))).toEqual([]);
  });

  it("never writes over odd headers: a taken Payments Log cell, blank-looking Tenants and Tenancy Log rows", async () => {
    const logs = captureLogs();
    const tabs = allTabs();
    tabs[LOG_TAB] = [[...LOG_HEADERS.slice(0, 7), "My own note", ""]];
    tabs[TENANTS_TAB] = [[" "]];
    tabs[TENANCY_LOG_TAB] = [["Whatever"]];
    const fake = new FakeGateway(tabs);
    const report = await ensureTabs(fake, "Schedule");
    // only the blank cell I1 of the Payments Log is filled; the owner's text in H1 and the odd rows are left alone
    expect(report).toEqual({ created: [], filled: [LOG_TAB] });
    expect(fake.tabs.get(LOG_TAB)![0][7]).toBe("My own note");
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([[" "]]);
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([["Whatever"]]);
    expect(loggedLines(logs.warn).map((l) => l.event)).toContain("payments-log-header-taken");
  });
});

describe("a cold start when Google does not answer", () => {
  it.each(["unavailable", "rate-limited"] as const)("fails with the same error as before when the reads are %s", async (fault) => {
    const fake = new FakeGateway(allTabs());
    const expected = await ensureTabs(withFaults(new FakeGateway(allTabs()), faults({ getValues: fault })), "Schedule").then(() => null, (e: unknown) => e);
    expect(expected).toBeInstanceOf(AppError);
    // a read that fails is read again by its own check, in order, and fails the same way: nothing is swallowed
    const error = await ensureTabs(withFaults(fake, faults({ getValues: fault })), "Schedule").then(() => null, (e: unknown) => e);
    expect((error as AppError).code).toBe((expected as AppError).code);
    expect((error as AppError).message).toBe((expected as AppError).message);
  });

  it("tells the first failure in the order the checks run: Settings before the Payments Log", async () => {
    class OrderedFailures extends FakeGateway {
      async getValues(tab: string, a1: string, render: Parameters<FakeGateway["getValues"]>[2]): Promise<unknown[][]> {
        if (tab === LOG_TAB) throw new AppError("unavailable", "log read failed");
        if (tab === SETTINGS_TAB) {
          await new Promise((resolve) => setTimeout(resolve, 20)); // answers later than the Log's failure
          throw new AppError("unavailable", "settings read failed");
        }
        return super.getValues(tab, a1, render);
      }
    }
    await expect(ensureTabs(new OrderedFailures(allTabs()), "Schedule")).rejects.toThrow("settings read failed");
  });
});

describe("a read that fails or hangs", () => {
  /** A Sheet whose first getValues of `tab` fails (once) or never answers, and that counts the reads of each tab. */
  function flaky(tab: string, how: "fail" | "hang") {
    const reads: Record<string, number> = {};
    class Flaky extends FakeGateway {
      async getValues(t: string, a1: string, render: Parameters<FakeGateway["getValues"]>[2]): Promise<unknown[][]> {
        reads[t] = (reads[t] ?? 0) + 1;
        if (t === tab && reads[t] === 1) {
          if (how === "hang") return new Promise<never>(() => {});
          throw new AppError("unavailable", `${t} read failed`);
        }
        return super.getValues(t, a1, render);
      }
    }
    return { fake: new Flaky(allTabs()), reads };
  }

  it.each([SETTINGS_TAB, LOG_TAB, TENANTS_TAB])("is not read a second time: a first read of %s that fails is the failure told, as before", async (tab) => {
    const { fake, reads } = flaky(tab, "fail");
    await expect(ensureTabs(fake, "Schedule")).rejects.toThrow(`${tab} read failed`);
    expect(reads[tab]).toBe(1);
  });

  it("is told by the check's own turn for the optional Tenancy Log: logged, and carried on, with the tab read once", async () => {
    const logs = captureLogs();
    const { fake, reads } = flaky(TENANCY_LOG_TAB, "fail");
    await expect(ensureTabs(fake, "Schedule")).resolves.toEqual({ created: [], filled: [] });
    expect(reads[TENANCY_LOG_TAB]).toBe(1);
    expect(loggedLines(logs.warn).map((line) => line.event)).toEqual(["tenancy-log-tab-failed"]);
  });

  it("does not make a failure wait for the reads after it: a failed Settings read is told while a later read still hangs", async () => {
    class SettingsFailsLogHangs extends FakeGateway {
      async getValues(t: string, a1: string, render: Parameters<FakeGateway["getValues"]>[2]): Promise<unknown[][]> {
        if (t === SETTINGS_TAB) throw new AppError("unavailable", "settings read failed");
        if (t === LOG_TAB) return new Promise<never>(() => {});
        return super.getValues(t, a1, render);
      }
    }
    const told = await Promise.race([
      ensureTabs(new SettingsFailsLogHangs(allTabs()), "Schedule").then(() => "no error", (e: unknown) => (e as Error).message),
      new Promise<string>((resolve) => setTimeout(() => resolve("waited"), 300)),
    ]);
    expect(told).toBe("settings read failed");
  });

  it("matches what the one-after-another checks did for a fault on the first call only (unavailable, then fine)", async () => {
    // Before, a first read that failed failed the check at once; the optional Tenancy Log carried on.
    for (const [tab, fatal] of [[SETTINGS_TAB, true], [LOG_TAB, true], [TENANTS_TAB, true], [TENANCY_LOG_TAB, false]] as const) {
      const { fake } = flaky(tab, "fail");
      const outcome = await ensureTabs(fake, "Schedule").then(() => "ok", (e: unknown) => (e as AppError).code);
      expect(outcome, tab).toBe(fatal ? "unavailable" : "ok");
    }
  });
});

describe("a Settings tab that is missing", () => {
  it("is refused right after the tab list, with no header read at all", async () => {
    const tabs = allTabs();
    delete (tabs as Record<string, unknown>)[SETTINGS_TAB];
    const fake = new FakeGateway(tabs);
    await expect(ensureTabs(fake, "Schedule")).rejects.toThrow("The Settings tab is missing");
    expect(fake.calls).toEqual(["listTabs"]);
  });
});

describe("two cold servers at once", () => {
  it("add each missing tab once and overwrite nothing", async () => {
    const tabs = { Schedule: baseSchedule(), [SETTINGS_TAB]: settingsGrid(), [LOG_TAB]: [[...LOG_HEADERS]] };
    const fake = new FakeGateway(tabs, { delayMs: 5 });
    const settingsBefore = structuredClone(fake.tabs.get(SETTINGS_TAB));
    const scheduleBefore = structuredClone(fake.tabs.get("Schedule"));
    const a = new FakeGatewayView(fake);
    const b = new FakeGatewayView(fake);
    await Promise.all([ensureTabs(a, "Schedule"), ensureTabs(b, "Schedule")]);
    expect([...fake.tabs.keys()].sort()).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB, TENANTS_TAB, TENANCY_LOG_TAB].sort());
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
    expect(fake.tabs.get(TENANCY_LOG_TAB)).toEqual([TENANCY_LOG_HEADERS]);
    expect(fake.tabs.get(SETTINGS_TAB)).toEqual(settingsBefore);
    expect(fake.tabs.get("Schedule")).toEqual(scheduleBefore);
  });
});

/** A second server's view of the same Sheet: its own gateway object (so its own "checked once" memory), the same grids. */
class FakeGatewayView implements SheetsGateway {
  constructor(private readonly sheet: FakeGateway) {}
  listTabs() { return this.sheet.listTabs(); }
  addTab(title: string) { return this.sheet.addTab(title); }
  getValues(...args: Parameters<FakeGateway["getValues"]>) { return this.sheet.getValues(...args); }
  getManyValues(...args: Parameters<FakeGateway["getManyValues"]>) { return this.sheet.getManyValues(...args); }
  updateValues(...args: Parameters<FakeGateway["updateValues"]>) { return this.sheet.updateValues(...args); }
  appendRow(...args: Parameters<FakeGateway["appendRow"]>) { return this.sheet.appendRow(...args); }
  appendRows(...args: Parameters<FakeGateway["appendRows"]>) { return this.sheet.appendRows(...args); }
  ensureColumnCount(...args: Parameters<FakeGateway["ensureColumnCount"]>) { return this.sheet.ensureColumnCount(...args); }
  cloneRow(...args: Parameters<FakeGateway["cloneRow"]>) { return this.sheet.cloneRow(...args); }
}

describe("a Sheet with its own tab names", () => {
  it("reads the owner's tabs, by their own titles, with the same three waits", async () => {
    const NAMES: TabNames = { schedule: "Schedule", settings: "Config", log: "Receipts", tenants: "People", "tenancy-log": "People history" };
    const fake = new FakeGateway(
      { Schedule: baseSchedule(), Config: settingsGrid(), Receipts: [[...LOG_HEADERS]], People: [[...TENANT_HEADERS]], "People history": [[...TENANCY_LOG_HEADERS]] },
      { delayMs: 5 },
    );
    const { gateway, seen } = watched(new NamedTabsGateway(fake, NAMES));
    const before = structuredClone([...fake.tabs.entries()]);
    await loadSnapshot(context(gateway));
    expect([...fake.tabs.entries()]).toEqual(before);
    expect(seen.waits).toBe(3);
    // the app's own tab names were never created beside the owner's
    expect([...fake.tabs.keys()]).toEqual(["Schedule", "Config", "Receipts", "People", "People history"]);
  });
});
