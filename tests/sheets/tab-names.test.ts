import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_NAMES, TAB_VARIABLES, tabNamesProblem, type TabNames } from "@/lib/sheets/tab-names";
import { LOG_TAB, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { TENANTS_TAB } from "@/lib/sheets/tenants-store";

// The names of the four tabs, and what is wrong when the owner gives two of them the same one. A module of its own, so that
// the environment can check them without loading the Sheet code (and, through it, the server log).

const DEFAULTS: TabNames = { schedule: "Schedule", settings: SETTINGS_TAB, log: LOG_TAB, tenants: TENANTS_TAB };

describe("the usual names", () => {
  it("are the names the rest of the app uses, with the variable that renames each", () => {
    expect(DEFAULT_TAB_NAMES).toEqual({ settings: "Settings", log: "Payments Log", tenants: "Tenants" });
    expect(TAB_VARIABLES).toEqual({ settings: "SETTINGS_TAB", log: "LOG_TAB", tenants: "TENANTS_TAB" });
    expect([SETTINGS_TAB, LOG_TAB, TENANTS_TAB]).toEqual([DEFAULT_TAB_NAMES.settings, DEFAULT_TAB_NAMES.log, DEFAULT_TAB_NAMES.tenants]);
  });
});

describe("what the tab names import", () => {
  const imports = (path: string) =>
    [...readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").matchAll(/^import[\s\S]*?from "([^"]+)";/gm)].map((match) => match[1]);

  it("keeps the module small: it needs only the header matching", () => {
    expect(imports("src/lib/sheets/tab-names.ts")).toEqual(["./headers"]);
  });

  it("is what the environment reads them from, so reading the environment does not load the Sheet code or the logger", () => {
    const found = imports("src/lib/server/env.ts");
    expect(found).toContain("@/lib/sheets/tab-names");
    for (const heavy of ["@/lib/sheets/named-tabs", "@/lib/sheets/settings-store", "@/lib/sheets/tenants-store", "@/lib/server/log"]) {
      expect(found, heavy).not.toContain(heavy);
    }
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
    expect(tabNamesProblem({ ...DEFAULTS, log: "Sett\u200bings" })).toBe(said);
    expect(tabNamesProblem({ ...DEFAULTS, settings: "Payments  Log" })).toBe(said);
  });

  it("refuses a Schedule named like one of the app's own tabs when that app tab has been given another name", () => {
    expect(tabNamesProblem({ ...DEFAULTS, schedule: "Tenants", tenants: "RentBook Tenants" })).toMatch(/SCHEDULE_TAB can't be "Tenants"/);
    expect(tabNamesProblem({ ...DEFAULTS, schedule: "payments log", log: "Rent Log" })).toMatch(/SCHEDULE_TAB can't be/);
  });
});

