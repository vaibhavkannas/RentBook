import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMonthView, logPayment, undoPayment } from "@/lib/sheets/service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, seededSettingsGrid } from "../support/fixtures";
import { withoutComments } from "../support/source-scan";

// The one place the app makes its Google gateway is src/lib/server/gateway-source.ts, so a test world (the screen tests, and the
// end-to-end run's temporary copy) can swap that one module and leave the environment, the named tabs and the caches as they are.
vi.mock("@/lib/server/gateway-source", () => ({ createGateway: vi.fn() }));
vi.mock("@/lib/sheets/google-gateway", () => ({ GoogleSheetsGateway: { fromServiceAccount: vi.fn() } }));

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = path.join(ROOT, "src");

const ENV = { GOOGLE_SERVICE_ACCOUNT_JSON: "{}", SHEET_ID: "sheet-id", ALLOWED_EMAILS: "owner@example.com" };

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The context, loaded fresh (it is kept per server), with `createGateway` answering `fake`. */
async function load(fake: FakeGateway) {
  const { createGateway } = await import("@/lib/server/gateway-source");
  vi.mocked(createGateway).mockReturnValue(fake);
  const context = await import("@/lib/server/context");
  return { ...context, createGateway: vi.mocked(createGateway) };
}

describe("getSheetsContext", () => {
  it("is made once and handed out again: the same object every time", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    const { getSheetsContext, createGateway } = await load(fake);
    expect(getSheetsContext()).toBe(getSheetsContext());
    expect(createGateway).toHaveBeenCalledTimes(1);
  });

  it("asks the gateway source for the environment's gateway", async () => {
    const { getSheetsContext, createGateway } = await load(new FakeGateway({ Schedule: baseSchedule() }));
    getSheetsContext();
    expect(createGateway).toHaveBeenCalledWith(expect.objectContaining({ serviceAccountJson: "{}", sheetId: "sheet-id" }));
  });

  it("reads the Sheet the gateway source gave it: September 2026 from the base Schedule", async () => {
    const { getSheetsContext } = await load(new FakeGateway({ Schedule: baseSchedule() }));
    const view = await getMonthView(getSheetsContext(), { year: 2026, month: 9 });
    expect(view.cards.map((card) => [card.portionId, card.status, card.entry?.tenant])).toEqual([
      ["p1", "paid", "Asha"],
      ["p2", "paid", "Bala"],
      ["p3", "paid", "Chitra"],
      ["p4", "needs-tenant", undefined],
      ["p5", "paid", "Esha"],
    ]);
  });
});

describe("buildSheetsContext", () => {
  it("puts the environment's tab names, total header and caches round the gateway it is given", async () => {
    const fake = new FakeGateway({ Rent: baseSchedule(), Settings: seededSettingsGrid(), "RentBook Tenants": [] });
    vi.stubEnv("SCHEDULE_TAB", "Rent");
    vi.stubEnv("TENANTS_TAB", "RentBook Tenants");
    vi.stubEnv("TOTAL_HEADER", "Total Rent");
    const { buildSheetsContext } = await load(fake);
    const { readEnv } = await import("@/lib/server/env");
    const ctx = buildSheetsContext(readEnv(process.env), fake);
    expect(ctx.scheduleTab).toBe("Rent");
    expect(ctx.totalHeader).toBe("Total Rent");
    expect(ctx.cache && ctx.activityCache && ctx.settingsCache && ctx.tenancyLogCache).toBeTruthy();
    // The app's name for the tab, whatever the owner called it.
    expect(await ctx.gateway.listTabs()).toEqual(["Rent", "Settings", "Tenants"]);
    expect(await ctx.gateway.getValues("Tenants", "A1", "UNFORMATTED_VALUE")).toEqual([]);
    expect(fake.calls).toEqual(["listTabs", "getValues"]);
  });

  it("makes a context of its own each time (only getSheetsContext keeps one)", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    const { buildSheetsContext } = await load(fake);
    const { readEnv } = await import("@/lib/server/env");
    expect(buildSheetsContext(readEnv(process.env), fake)).not.toBe(buildSheetsContext(readEnv(process.env), fake));
  });
});

describe("what the seam leaves as it was: a log and an undo", () => {
  // Captured from the wiring before the seam existed (the Google gateway built inside getSheetsContext): the same calls to the
  // gateway, in the same order, and the same grids.
  const OPTIONS = { now: new Date("2026-10-05T04:30:00Z"), retryDelayMs: 0, loggedBy: "member@example.com" };
  const OCT = { year: 2026, month: 10 };
  const LOGGED = ["2026-10-05T04:30:00.000Z", "2026-10", "First floor, single bedroom", "Asha", 5450, 4, "2026-10-05", "member@example.com", "Logged"];
  const UNDONE = ["2026-10-05T04:30:00.000Z", "2026-10", "First floor, single bedroom", "Asha", 5450, 4, "", "member@example.com", "Undone"];

  const grids = (fake: FakeGateway) => structuredClone(Object.fromEntries(fake.tabs));

  it("ask Google for the same things and leave the same Sheet", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    const { getSheetsContext } = await load(fake);
    const ctx = getSheetsContext();

    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect(fake.calls).toEqual([
      // the tab check: list the tabs, read the Settings seed, add and seed the four app tabs
      "listTabs", "getValues",
      "addTab", "updateValues", "addTab", "updateValues", "addTab", "updateValues", "addTab", "updateValues",
      // the snapshot, the month row's source and target, the copy, the total check, the read-back and the Payments Log row
      "getManyValues", "getValues", "getValues", "cloneRow", "updateValues", "getValues", "appendRow",
    ]);
    const afterLog = grids(fake);
    const october = (cells: unknown[]) => [
      ...baseSchedule(),
      ["Oct-26", ...cells, ...Array(12).fill(undefined), "=D6+G6+J6+M6+P6"],
    ];
    expect(afterLog["Schedule"]).toEqual(october(["Asha", 4, 5450]));
    expect(afterLog["Payments Log"]?.[1]).toEqual(LOGGED);

    fake.calls = [];
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } }, OPTIONS);
    expect(fake.calls).toEqual(["getManyValues", "updateValues", "getValues", "appendRow"]);
    const afterUndo = grids(fake);
    expect(afterUndo["Schedule"]).toEqual(october(["", "", ""]));
    expect(afterUndo["Settings"]).toEqual(seededSettingsGrid());
    expect(afterUndo["Payments Log"]).toEqual([
      ["Saved at", "Month", "Portion", "Tenant", "Amount", "Count", "Date received", "Logged by", "Action"],
      LOGGED,
      UNDONE,
    ]);
    expect(afterUndo["Tenants"]).toHaveLength(1);
    expect(afterUndo["Tenancy Log"]).toHaveLength(1);
    expect([...fake.tabs.keys()]).toEqual(["Schedule", "Settings", "Payments Log", "Tenants", "Tenancy Log"]);
  });
});

describe("createGateway", () => {
  it("is the Google gateway for the environment's service account and Sheet", async () => {
    const { GoogleSheetsGateway } = await import("@/lib/sheets/google-gateway");
    const google = new FakeGateway();
    vi.mocked(GoogleSheetsGateway.fromServiceAccount).mockReturnValue(google as never);
    const { createGateway } = await vi.importActual<typeof import("@/lib/server/gateway-source")>("@/lib/server/gateway-source");
    const { readEnv } = await import("@/lib/server/env");
    expect(createGateway(readEnv(process.env))).toBe(google);
    expect(GoogleSheetsGateway.fromServiceAccount).toHaveBeenCalledWith("{}", "sheet-id");
  });
});

const sourceFiles = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => name.split(path.sep).join("/"))
  .sort();

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), "utf8"));

describe("the seam in the source", () => {
  it("has one place that makes the Google gateway for the app: gateway-source.ts (and google-gateway.ts defines it)", () => {
    expect(sourceFiles.filter((file) => code(file).includes("fromServiceAccount")).sort()).toEqual([
      "lib/server/gateway-source.ts",
      "lib/sheets/google-gateway.ts",
    ]);
  });

  it("keeps gateway-source.ts to one exported function", () => {
    const source = code("lib/server/gateway-source.ts");
    expect(source.trimStart().startsWith('import "server-only";')).toBe(true);
    expect([...source.matchAll(/^export\s+(?:async\s+)?(\w+)\s+(\w+)/gm)].map((match) => `${match[1]} ${match[2]}`)).toEqual(["function createGateway"]);
  });

  it("is imported by context.ts alone", () => {
    expect(sourceFiles.filter((file) => /gateway-source["']/.test(code(file)))).toEqual(["lib/server/context.ts"]);
  });

  it("never imports from tests/ or scripts/", () => {
    const reaching = sourceFiles.filter((file) => /(?:from\s+|import\s*\(\s*|import\s+)["'][^"']*(?:\/|^)(?:tests|scripts)\//.test(code(file)));
    expect(reaching).toEqual([]);
  });
});

describe("the end-to-end run's dependency", () => {
  it("is not in package.json or the lock file: Playwright is used from outside the project", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
    const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as { packages: Record<string, unknown> };
    const banned = /(?:^|\/)(?:playwright|playwright-core|@playwright\/test)$/;
    const declared = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((field) =>
      Object.keys((pkg[field] ?? {}) as Record<string, string>),
    );
    expect(declared.filter((name) => banned.test(name))).toEqual([]);
    // Only the lock file's own entries: another package may list Playwright among its optional peers.
    expect(Object.keys(lock.packages).filter((key) => banned.test(key))).toEqual([]);
    const root = lock.packages[""] as Record<string, Record<string, string> | undefined>;
    expect(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap((field) => Object.keys(root[field] ?? {})).filter((name) => banned.test(name))).toEqual([]);
  });
});
