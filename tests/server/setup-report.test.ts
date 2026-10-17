import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configError } from "@/lib/errors";
import { setupReport, FIX_SETTINGS_FIRST } from "@/lib/server/setup-report";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import type { SheetsContext } from "@/lib/sheets/service";
import { LOG_HEADERS, LOG_TAB, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid } from "../support/fixtures";

// What the Set up page and Diagnostics both read: the environment's checks, then the Sheet's, in one list.

const KEY = JSON.stringify({ client_email: "robot@example-project.iam.gserviceaccount.com", private_key: "k" });
const ENV: Record<string, string> = {
  AUTH_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
  AUTH_GOOGLE_ID: "client-id",
  AUTH_GOOGLE_SECRET: "client-secret",
  ALLOWED_EMAILS: "owner@example.com",
  GOOGLE_SERVICE_ACCOUNT_JSON: KEY,
  SHEET_ID: "1AbCdEf",
  TOTAL_HEADER: "Total Rent",
};

const ctxFor = (gateway: FakeGateway | NamedTabsGateway): SheetsContext => ({ gateway, scheduleTab: "Schedule", totalHeader: "Total Rent" });
const healthy = () =>
  new FakeGateway({
    Schedule: baseSchedule(),
    [SETTINGS_TAB]: settingsGrid(),
    [LOG_TAB]: [[...LOG_HEADERS]],
    [TENANTS_TAB]: [[...TENANT_HEADERS]],
  });

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => vi.restoreAllMocks());

describe("setupReport", () => {
  it("lists the environment's checks, then the Sheet's, each with an id of its own", async () => {
    for (const gateway of [healthy(), new FakeGateway({ Schedule: baseSchedule() })]) {
      const { checks, facts } = await setupReport(ENV, () => ctxFor(gateway));
      const ids = checks.map((check) => check.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.indexOf("service-account")).toBeLessThan(ids.indexOf("connection"));
      expect(checks.filter((check) => check.step === 4).map((check) => check.id)).toEqual([
        "schedule-tab-name",
        "total-header",
        "schedule-tab",
        "header-row",
        "months",
        "row-below",
        "total",
      ]);
      expect(facts).not.toBeNull();
    }
  });

  it("gives the names the app's tabs have in the Sheet: the usual ones, or the owner's", async () => {
    expect((await setupReport(ENV, () => ctxFor(healthy()))).appTabNames).toEqual({ settings: "Settings", log: "Payments Log", tenants: "Tenants" });
    const named = { ...ENV, TENANTS_TAB: "RentBook Tenants" };
    expect((await setupReport(named, () => ctxFor(healthy()))).appTabNames).toEqual({
      settings: "Settings",
      log: "Payments Log",
      tenants: "RentBook Tenants",
    });
  });

  it("makes the Sheet's checks wait, and says to fix the settings, when the settings cannot open the Sheet", async () => {
    const { checks, facts, appTabNames } = await setupReport({ ...ENV, SHEET_ID: undefined }, () => {
      throw configError("Missing environment variables: SHEET_ID.");
    });
    expect(facts).toBeNull();
    expect(appTabNames).toBeNull();
    expect(checks.filter((check) => check.status === "skip")).toHaveLength(10);
    for (const check of checks.filter((entry) => entry.status === "skip")) expect(check.detail).toBe(FIX_SETTINGS_FIRST);
    expect(checks.find((check) => check.id === "sheet-id")).toMatchObject({ status: "fail", detail: "Not set." });
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("keeps the tab names when only the connection could not be made, and logs a failure that is not a config error", async () => {
    const { checks, facts, appTabNames } = await setupReport(ENV, () => {
      throw new Error("something unexpected CANARY");
    });
    expect(facts).toBeNull();
    expect(appTabNames).toEqual({ settings: "Settings", log: "Payments Log", tenants: "Tenants" });
    expect(JSON.stringify(checks)).not.toContain("CANARY");
    expect(loggedLines(logs.error)).toEqual([expect.objectContaining({ event: "setup-context-failed" })]);
  });

  it("asks the wrapper for the titles the tab list found, without a call of its own", async () => {
    const inner = new FakeGateway({
      schedule: baseSchedule(),
      settings: settingsGrid(),
      "payments log": [[...LOG_HEADERS]],
      "RentBook Tenants": [[...TENANT_HEADERS]],
    });
    const wrapper = new NamedTabsGateway(inner, { schedule: "Schedule", settings: SETTINGS_TAB, log: LOG_TAB, tenants: "RentBook Tenants" });
    const { checks } = await setupReport({ ...ENV, TENANTS_TAB: "RentBook Tenants" }, () => ctxFor(wrapper));
    expect(inner.calls).toEqual(["listTabs", "getManyValues", "getValues"]);
    expect(checks.find((check) => check.id === "schedule-tab")?.detail).toBe('Found the tab "schedule".');
    expect(checks.find((check) => check.id === "log")?.detail).toBe('Found as "payments log". Headers are right. 0 entries.');
  });

  it("gives the real titles of the tabs when the gateway can say them, and none when it cannot or the Sheet was not opened", async () => {
    const inner = new FakeGateway({
      schedule: baseSchedule(),
      settings: settingsGrid(),
      "payments log": [[...LOG_HEADERS]],
      "RentBook Tenants": [[...TENANT_HEADERS]],
    });
    const wrapper = new NamedTabsGateway(inner, { schedule: "Schedule", settings: SETTINGS_TAB, log: LOG_TAB, tenants: "RentBook Tenants" });
    expect((await setupReport(ENV, () => ctxFor(wrapper))).realTitles).toEqual({
      schedule: "schedule",
      settings: "settings",
      log: "payments log",
      tenants: "RentBook Tenants",
    });
    expect((await setupReport(ENV, () => ctxFor(healthy()))).realTitles).toBeNull();
    expect(
      (
        await setupReport(ENV, () => {
          throw configError("x");
        })
      ).realTitles,
    ).toBeNull();
  });

  it("never writes to the Sheet", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await setupReport(ENV, () => ctxFor(fake));
    for (const write of ["addTab", "updateValues", "appendRow", "cloneRow"]) expect(fake.calls).not.toContain(write);
  });
});
