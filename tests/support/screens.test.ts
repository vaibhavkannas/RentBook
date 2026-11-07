import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertAuthConfig, readEnv } from "@/lib/server/env";
import { getMonthView } from "@/lib/sheets/service";
import { landmarkProblems } from "./landmarks";
import { captureLogs } from "./logs";
import { CANARIES, FIXED_NOW, MEMBER, OWNER, renderScreen, screenContext, stubTestEnv, TEST_ENV } from "./screens";
import { smallTargets } from "./tap-targets";
import { faults, world } from "./worlds";

// The mock block of screens.ts, copied.
import type { Viewer } from "@/lib/server/auth-guard";
import type { SheetsContext } from "@/lib/sheets/service";

const h = vi.hoisted(() => ({
  viewer: null as Viewer | null, // who getViewer() answers: null is a person who is not signed in
  ctx: (() => {
    throw new Error("The test gave the page no Sheet.");
  }) as () => SheetsContext, // what the page's getSheetsContext() answers
  path: "/", // what usePathname() answers
  search: "", // what useSearchParams() answers, as a query string
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({ refresh() {}, back() {}, replace() {}, push() {} }),
  usePathname: () => h.path,
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set() {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: async () => h.viewer }));
vi.mock("@/lib/server/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/context")>()),
  getSheetsContext: () => h.ctx(),
}));

import Home from "@/app/page";

beforeEach(() => {
  captureLogs();
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  h.viewer = OWNER;
  h.ctx = () => screenContext("main").ctx;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a screen rendered through the harness", () => {
  it("is the real page reading the world's Sheet: the month screen of 17 October 2026", async () => {
    const html = renderScreen(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("October 2026");
    expect(html).toContain("First floor, single bedroom");
    expect(html).toContain("Third floor, hall and kitchen");
    expect(landmarkProblems(html)).toEqual([]);
    expect(smallTargets(html)).toEqual([]);
  });

  it("answers what the mock block says: a person who is not signed in is sent to sign in", async () => {
    h.viewer = null;
    await expect(Home({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });

  it("gives the page the Sheet the test chose, and the viewer the test chose: a member in the empty world sees no tenant", async () => {
    h.viewer = MEMBER;
    h.ctx = () => screenContext("empty").ctx;
    const html = renderScreen(await Home({ searchParams: Promise.resolve({ month: "2026-10" }) }));
    expect(html).toContain("First floor, single bedroom");
    expect(html).not.toContain("Asha");
  });
});

describe("screenContext", () => {
  it("builds the app's own context: the Schedule tab and the total header of TEST_ENV, with the caches", () => {
    const { ctx } = screenContext("main");
    expect(ctx.scheduleTab).toBe("Schedule");
    expect(ctx.totalHeader).toBe("Total Rent");
    expect(ctx.cache && ctx.activityCache && ctx.settingsCache && ctx.tenancyLogCache).toBeTruthy();
  });

  it("takes a world by name on FIXED_NOW, or on another day, or tabs a test made", async () => {
    expect([...screenContext("main").fake.tabs.keys()]).toEqual(["Schedule", "Settings", "Payments Log", "Tenants", "Tenancy Log"]);
    expect([...screenContext("fresh").fake.tabs.keys()]).toEqual(["Schedule"]);
    const later = screenContext("main", { now: new Date("2027-01-03T06:30:00Z") });
    expect(later.fake.tabs.get("Schedule")?.[3][0]).toBe("Nov-26");
    expect(screenContext("main").fake.tabs.get("Schedule")?.[3][0]).toBe("Aug-26");
    const tabs = world("main", FIXED_NOW).tabs;
    tabs.Settings[1][1] = "Changed";
    const { ctx } = screenContext(tabs);
    expect((await getMonthView(ctx, { year: 2026, month: 10 })).cards[0].name).toBe("Changed");
  });

  it("reads the Sheet through the real data path: the tab check, then the one read of the snapshot, and no write", async () => {
    const { ctx, fake } = screenContext("main");
    await getMonthView(ctx, { year: 2026, month: 10 });
    expect(fake.calls[0]).toBe("listTabs");
    expect(fake.calls.filter((call) => call === "getManyValues")).toHaveLength(1);
    expect(fake.calls.filter((call) => !call.startsWith("get") && call !== "listTabs")).toEqual([]);
  });

  it("fails the gateway's methods named in the faults it is given, and a test may change them later", async () => {
    const set = faults({ getManyValues: "unavailable" });
    const { ctx } = screenContext("main", { faults: set });
    await expect(getMonthView(ctx, { year: 2026, month: 10 })).rejects.toMatchObject({ code: "unavailable" });
    delete set.getManyValues;
    expect((await getMonthView(ctx, { year: 2026, month: 10 })).cards).toHaveLength(5);
  });
});

describe("TEST_ENV", () => {
  it("is a complete set of settings", () => {
    expect(() => assertAuthConfig(TEST_ENV)).not.toThrow();
    expect(readEnv(TEST_ENV)).toMatchObject({ sheetId: TEST_ENV.SHEET_ID, totalHeader: "Total Rent", allowedEmails: ["owner@example.com", "member@example.com"] });
  });

  it("uses example.com addresses only", () => {
    const emails = JSON.stringify(TEST_ENV).match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email).toMatch(/@example\.com$/);
  });

  it("has a canary in each secret, and lists them", () => {
    expect(CANARIES).toHaveLength(4);
    for (const canary of CANARIES) {
      expect(canary).toContain("CANARY");
      expect(Object.values(TEST_ENV).filter((value) => value.includes(canary))).toHaveLength(1);
    }
    expect(TEST_ENV.AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("is what stubTestEnv puts in the process's settings, after clearing the ones it does not set", () => {
    vi.stubEnv("TENANTS_TAB", "Somebody else's tab");
    stubTestEnv();
    expect(process.env.AUTH_SECRET).toBe(TEST_ENV.AUTH_SECRET);
    expect(process.env.TENANTS_TAB).toBeUndefined();
    stubTestEnv({ AUTH_URL: "https://rentbook.example.com", SHEET_ID: undefined });
    expect(process.env.AUTH_URL).toBe("https://rentbook.example.com");
    expect(process.env.SHEET_ID).toBeUndefined();
    vi.unstubAllEnvs();
    expect(process.env.AUTH_SECRET).not.toBe(TEST_ENV.AUTH_SECRET);
  });
});
