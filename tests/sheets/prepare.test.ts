import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import type { Check } from "@/lib/setup-checks";
import { prepareOffer } from "@/lib/setup-prepare";
import { NamedTabsGateway, type TabNames } from "@/lib/sheets/named-tabs";
import { prepareSheet } from "@/lib/sheets/prepare";
import type { SheetsContext } from "@/lib/sheets/service";
import { checkSheet } from "@/lib/sheets/sheet-checks";
import { ensureTabs, LOG_HEADERS, LOG_TAB, readSettings, SETTINGS_HEADERS, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

// Prepare my Sheet: the one thing the Set up page can change. It creates the tabs the app needs and writes their headers
// (and the first Settings rows), exactly as the app does on its first page view, and never touches what is there.

const DEFAULT_NAMES: TabNames = { schedule: "Schedule", settings: SETTINGS_TAB, log: LOG_TAB, tenants: TENANTS_TAB };

const ctxFor = (gateway: FakeGateway | NamedTabsGateway, extra: Partial<SheetsContext> = {}): SheetsContext => ({
  gateway,
  scheduleTab: "Schedule",
  totalHeader: TOTAL_HEADER,
  ...extra,
});

const fresh = (extra: Record<string, unknown[][]> = {}) => new FakeGateway({ Schedule: baseSchedule(), ...extra });

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

afterEach(() => vi.restoreAllMocks());

describe("prepareSheet", () => {
  it("creates and fills the three tabs on a Sheet that has only the Schedule, and says which", async () => {
    const fake = fresh();
    const result = await prepareSheet(ctxFor(fake));
    expect(result).toEqual({ created: ["Settings", "Payments Log", "Tenants"] });
    expect([...fake.tabs.keys()]).toEqual(["Schedule", "Settings", "Payments Log", "Tenants"]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    expect(fake.tabs.get(TENANTS_TAB)).toEqual([TENANT_HEADERS]);
    const settings = fake.tabs.get(SETTINGS_TAB)!;
    expect(settings[0]).toEqual(SETTINGS_HEADERS);
    expect(settings.slice(1).map((row) => row[0])).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect((await readSettings(fake)).map((p) => [p.cycleLength, p.hikePercent])).toEqual(Array(5).fill([11, 5]));
  });

  it("creates only what is missing, and leaves every tab that is there exactly as it is", async () => {
    const settings = [[...SETTINGS_HEADERS], ["p1", "Ground", "Tenant", "Count", "Amount", 6, 8]];
    const fake = fresh({ [SETTINGS_TAB]: settings, [LOG_TAB]: [[...LOG_HEADERS], ["2026-10-05T04:30:00.000Z", "2026-10", "p1", "Asha", 5450, 3, "2026-10-05", "owner@example.com", "Logged"]] });
    const before = structuredClone([...fake.tabs.entries()]);
    expect(await prepareSheet(ctxFor(fake))).toEqual({ created: ["Tenants"] });
    expect(fake.tabs.get(SETTINGS_TAB)).toEqual(before.find(([name]) => name === SETTINGS_TAB)![1]);
    expect(fake.tabs.get(LOG_TAB)).toEqual(before.find(([name]) => name === LOG_TAB)![1]);
    expect(fake.tabs.get("Schedule")).toEqual(before.find(([name]) => name === "Schedule")![1]);
    expect(fake.calls.filter((call) => call === "addTab")).toHaveLength(1);
  });

  it("does nothing, and says nothing was created, when every tab is there", async () => {
    const fake = fresh();
    await ensureTabs(fake, "Schedule");
    const before = structuredClone([...fake.tabs.entries()]);
    fake.calls = [];
    expect(await prepareSheet(ctxFor(fake))).toEqual({ created: [] });
    expect([...fake.tabs.entries()]).toEqual(before);
    for (const write of ["addTab", "updateValues", "appendRow", "cloneRow"]) expect(fake.calls).not.toContain(write);
  });

  it("refuses, writing nothing, when Settings is missing but the Tenants tab is there: it is never recreated", async () => {
    const fake = fresh({ [TENANTS_TAB]: [[...TENANT_HEADERS]] });
    const before = structuredClone([...fake.tabs.entries()]);
    const error = await refusal(prepareSheet(ctxFor(fake)));
    expect(error.code).toBe("sheet-structure");
    expect(error.message).toBe(
      "The Settings tab is missing. Restore it from File > Version history or rename it back. RentBook will not recreate it because that would reset your rent cycle lengths and hike percentages.",
    );
    for (const write of ["addTab", "updateValues", "appendRow", "cloneRow"]) expect(fake.calls).not.toContain(write);
    expect([...fake.tabs.entries()]).toEqual(before);
  });

  it("refuses, writing nothing, when the Schedule's header cannot be turned into portions", async () => {
    const schedule = baseSchedule();
    schedule[2][1] = "Tenant Name";
    const fake = new FakeGateway({ Schedule: schedule });
    const error = await refusal(prepareSheet(ctxFor(fake)));
    expect(error.code).toBe("sheet-structure");
    expect(fake.calls).not.toContain("addTab");
    expect([...fake.tabs.keys()]).toEqual(["Schedule"]);
  });

  it("looks at the Sheet again, so a tab the owner has deleted since the app last checked is put back", async () => {
    const fake = fresh();
    const ctx = ctxFor(fake);
    await ensureTabs(fake, "Schedule");
    fake.tabs.delete(LOG_TAB);
    expect(await prepareSheet(ctx)).toEqual({ created: ["Payments Log"] });
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
  });

  it("names the tabs by the names the owner gave them, which is what it creates", async () => {
    const inner = fresh();
    const wrapper = new NamedTabsGateway(inner, { ...DEFAULT_NAMES, settings: "My Settings", tenants: "RentBook Tenants" });
    const result = await prepareSheet(ctxFor(wrapper));
    expect(result).toEqual({ created: ["My Settings", "Payments Log", "RentBook Tenants"] });
    expect([...inner.tabs.keys()]).toEqual(["Schedule", "My Settings", "Payments Log", "RentBook Tenants"]);
  });

  it("takes its turn among the writes: two at once create each tab once", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() }, { delayMs: 2 });
    const ctx = ctxFor(fake);
    const [first, second] = await Promise.all([prepareSheet(ctx), prepareSheet(ctx)]);
    expect(first).toEqual({ created: ["Settings", "Payments Log", "Tenants"] });
    expect(second).toEqual({ created: [] });
    expect(fake.calls.filter((call) => call === "addTab")).toHaveLength(3);
  });

  it("never reads through the page caches, and throws all of them away, after a success and after a failure", async () => {
    const cache = { get: vi.fn(), invalidate: vi.fn() };
    const activityCache = { get: vi.fn(), invalidate: vi.fn() };
    const settingsCache = { get: vi.fn(), invalidate: vi.fn() };
    const withCaches = (fake: FakeGateway) =>
      ctxFor(fake, { cache: cache as never, activityCache: activityCache as never, settingsCache: settingsCache as never });
    await prepareSheet(withCaches(fresh()));
    await refusal(prepareSheet(withCaches(fresh({ [TENANTS_TAB]: [[...TENANT_HEADERS]] }))));
    for (const each of [cache, activityCache, settingsCache]) {
      expect(each.get).not.toHaveBeenCalled();
      expect(each.invalidate).toHaveBeenCalledTimes(2);
    }
  });

  it("says so, and what to do, when a tab it made is not in the Sheet when it looks again", async () => {
    class Forgetful extends FakeGateway {
      lists = 0;
      async listTabs() {
        const tabs = await super.listTabs();
        return ++this.lists >= 3 ? tabs.filter((tab) => tab !== TENANTS_TAB) : tabs;
      }
    }
    const fake = new Forgetful({ Schedule: baseSchedule() });
    const error = await refusal(prepareSheet(ctxFor(fake)));
    expect(error.code).toBe("conflict");
    expect(error.message).toBe(
      "Your Sheet may not be fully prepared: Tenants is not there yet. Tap another tab at the bottom of the screen and come back, then check Set up.",
    );
  });
});

const COPY = {
  adds: "Adds the missing tabs (Settings, Payments Log and Tenants) with their headers. Nothing already in your Sheet is changed.",
  settings:
    "Settings starts with 5 portions from your Schedule header, each with 11 payments per cycle and a 5% hike. Check them in Portion settings before the first payment.",
};

async function checksFor(fake: FakeGateway, options: Parameters<typeof checkSheet>[1] = { scheduleTab: "Schedule", totalHeader: TOTAL_HEADER }) {
  return checkSheet(fake, options, () => 0);
}

describe("prepareOffer", () => {
  it("offers to add the three tabs to a Sheet with only the Schedule, with what Settings starts with", async () => {
    const { checks, facts } = await checksFor(fresh());
    expect(prepareOffer(checks, facts)).toEqual({
      tabs: ["Settings", "Payments Log", "Tenants"],
      lines: [COPY.adds, COPY.settings],
    });
  });

  it("says only what is true when one tab is missing, in the singular", async () => {
    const full = fresh();
    await ensureTabs(full, "Schedule");
    full.tabs.delete(LOG_TAB);
    const { checks, facts } = await checksFor(full);
    expect(prepareOffer(checks, facts)).toEqual({
      tabs: ["Payments Log"],
      lines: ["Adds the missing tab (Payments Log) with its headers. Nothing already in your Sheet is changed."],
    });
  });

  it("says a Settings tab with one portion starts with one portion", async () => {
    const schedule = baseSchedule().map((row) => row.slice(0, 4).concat(row.slice(-1)));
    const { checks, facts } = await checksFor(new FakeGateway({ Schedule: schedule }));
    const offer = prepareOffer(checks, facts)!;
    expect(offer.lines[1]).toBe(
      "Settings starts with 1 portion from your Schedule header, with 11 payments per cycle and a 5% hike. Check it in Portion settings before the first payment.",
    );
  });

  it("offers nothing when there is nothing to prepare", async () => {
    const full = fresh();
    await ensureTabs(full, "Schedule");
    const { checks, facts } = await checksFor(full);
    expect(prepareOffer(checks, facts)).toBeNull();
  });

  it("offers nothing while the Schedule, the connection or the service account has a problem to fix first", async () => {
    const { checks, facts } = await checksFor(fresh());
    for (const [id, step] of [
      ["connection", 3],
      ["header-row", 4],
      ["months", 4],
    ] as const) {
      const failing: Check[] = checks.map((check) => (check.id === id ? { ...check, status: "fail", detail: "Broken.", fix: "Fix it." } : check));
      expect(failing.some((check) => check.step === step && check.status === "fail")).toBe(true);
      expect(prepareOffer(failing, facts), id).toBeNull();
    }
    const env: Check = { id: "service-account", step: 2, title: "GOOGLE_SERVICE_ACCOUNT_JSON", status: "fail", detail: "Not set.", fix: "Paste it." };
    expect(prepareOffer([env, ...checks], facts)).toBeNull();
  });

  it("still offers it when a problem is only a warning, or is in the sign-in step, which the page could not be seen without", async () => {
    const { checks, facts } = await checksFor(fresh());
    const warned = checks.map((check) => (check.id === "row-below" ? { ...check, status: "warn" as const, detail: "Busy.", fix: "Clear it." } : check));
    expect(prepareOffer(warned, facts)).not.toBeNull();
    const signIn: Check = { id: "auth-url", step: 1, title: "AUTH_URL", status: "fail", detail: "Not a plain web address.", fix: "Fix it." };
    expect(prepareOffer([signIn, ...checks], facts)).not.toBeNull();
  });

  it("leaves out the sentence about Settings when Settings is not one of the tabs it adds", async () => {
    const full = fresh();
    await ensureTabs(full, "Schedule");
    full.tabs.delete(TENANTS_TAB);
    const { checks, facts } = await checksFor(full);
    expect(prepareOffer(checks, facts)!.lines).toHaveLength(1);
  });

  it("names the tabs by the names the owner gave them, and says to rename an old tab first", async () => {
    const names = { settings: "My Settings", log: "Payments Log", tenants: "RentBook Tenants" };
    const wrapper = new NamedTabsGateway(fresh(), { ...DEFAULT_NAMES, ...names });
    const { checks, facts } = await checkSheet(wrapper, { scheduleTab: "Schedule", totalHeader: TOTAL_HEADER, appTabNames: names }, () => 0);
    const offer = prepareOffer(checks, facts, names)!;
    expect(offer.tabs).toEqual(["My Settings", "Payments Log", "RentBook Tenants"]);
    expect(offer.lines[0]).toBe(
      "Adds the missing tabs (My Settings, Payments Log and RentBook Tenants) with their headers. Nothing already in your Sheet is changed.",
    );
    expect(offer.lines[2]).toBe(
      "You gave SETTINGS_TAB and TENANTS_TAB a name that is not in your Sheet yet. If you already have those tabs under other names, rename them in your Sheet first, then use Check again: Prepare my Sheet would start new, empty ones and leave your old tabs alone.",
    );
  });

  it("gives the rename warning in the singular for one tab, and none for tabs with their usual names", async () => {
    const names = { settings: "Settings", log: "My Log", tenants: "Tenants" };
    const wrapper = new NamedTabsGateway(fresh(), { ...DEFAULT_NAMES, log: "My Log" });
    const { checks, facts } = await checkSheet(wrapper, { scheduleTab: "Schedule", totalHeader: TOTAL_HEADER, appTabNames: names }, () => 0);
    expect(prepareOffer(checks, facts, names)!.lines[2]).toBe(
      "You gave LOG_TAB a name that is not in your Sheet yet. If you already have that tab under another name, rename it in your Sheet first, then use Check again: Prepare my Sheet would start a new, empty one and leave your old tab alone.",
    );
    const plain = await checksFor(fresh());
    expect(prepareOffer(plain.checks, plain.facts, { settings: "Settings", log: "Payments Log", tenants: "Tenants" })!.lines).toHaveLength(2);
  });
});
