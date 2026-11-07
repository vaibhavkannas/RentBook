import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, vi } from "vitest";
import type { Viewer } from "@/lib/server/auth-guard";
import { buildSheetsContext } from "@/lib/server/context";
import { readEnv } from "@/lib/server/env";
import type { SheetsContext } from "@/lib/sheets/service";
import { FakeGateway } from "./fake-gateway";
import { landmarkProblems } from "./landmarks";
import { smallTargets } from "./tap-targets";
import { faults as noFaults, MEMBER_EMAIL, OWNER_EMAIL, withFaults, world, type Faults, type Tabs, type WorldName } from "./worlds";

/**
 * The harness of the screen tests: a real page (a server component) rendered through the real data path (the page's own
 * reads, the caches, the named tabs, the parsing) against the in-memory Sheet of a world (worlds.ts). Only the edges are
 * replaced: who is signed in, the request, and the context the page gets its Sheet from.
 *
 * Every screen test file begins with the block below, copied. Vitest hoists `vi.mock` to the top of the file it is in, so
 * the block cannot live in this module and be shared.
 *
 *   import type { Viewer } from "@/lib/server/auth-guard";
 *   import type { SheetsContext } from "@/lib/sheets/service";
 *
 *   const h = vi.hoisted(() => ({
 *     viewer: null as Viewer | null, // who getViewer() answers: null is a person who is not signed in
 *     ctx: (() => {
 *       throw new Error("The test gave the page no Sheet.");
 *     }) as () => SheetsContext, // what the page's getSheetsContext() answers
 *     path: "/", // what usePathname() answers
 *     search: "", // what useSearchParams() answers, as a query string
 *   }));
 *   vi.mock("next/navigation", () => ({
 *     redirect: (to: string) => {
 *       throw new Error(`redirect:${to}`);
 *     },
 *     notFound: () => {
 *       throw new Error("not-found");
 *     },
 *     useRouter: () => ({ refresh() {}, back() {}, replace() {}, push() {} }),
 *     usePathname: () => h.path,
 *     useSearchParams: () => new URLSearchParams(h.search),
 *   }));
 *   vi.mock("next/headers", () => ({
 *     cookies: async () => ({ get: () => undefined, set() {} }),
 *     headers: async () => new Headers(),
 *   }));
 *   vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
 *   vi.mock("@/lib/server/auth-guard", () => ({ getViewer: async () => h.viewer }));
 *   vi.mock("@/lib/server/context", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("@/lib/server/context")>()),
 *     getSheetsContext: () => h.ctx(),
 *   }));
 *
 * A test then sets `h.viewer = OWNER`, `h.ctx = () => screenContext("main").ctx` and the day (see FIXED_NOW), awaits the
 * page's server component and gives what it returns to `renderScreen`. A page that logs a problem needs `captureLogs()` from
 * ../support/logs, so the test's output stays quiet.
 */

/** The owner and a member, as `getViewer()` gives them. */
export const OWNER: Viewer = { email: OWNER_EMAIL, isOwner: true };
export const MEMBER: Viewer = { email: MEMBER_EMAIL, isOwner: false };

/**
 * The day the screen tests are on: 17 October 2026, 12:00 in India. A test fixes it with
 * `vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW })` (only Date, so promises and timers run as usual) and
 * `vi.useRealTimers()` afterwards.
 */
export const FIXED_NOW = new Date("2026-10-17T06:30:00Z");

/** A piece of every secret that the tests look for on a screen: none of them may ever be shown. */
const AUTH_SECRET = "CANARY-auth-secret-0123456789abcdef";
const AUTH_GOOGLE_SECRET = "CANARY-google-client-secret";
const PRIVATE_KEY = "CANARY-private-key-body";
const SHEET_ID = "CANARY-sheet-id-0123456789";

/**
 * A complete set of settings, every value made up: the secrets hold a canary (see CANARIES), the service account is an
 * example.com address (a Set up page shows that one address on purpose) and the people are the owner and a member.
 */
export const TEST_ENV: Record<string, string> = {
  AUTH_SECRET,
  AUTH_GOOGLE_ID: "client-id.apps.example.com",
  AUTH_GOOGLE_SECRET,
  ALLOWED_EMAILS: `${OWNER_EMAIL}, ${MEMBER_EMAIL}`,
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: "service_account",
    client_email: "rentbook-robot@example.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${PRIVATE_KEY}\n-----END PRIVATE KEY-----\n`,
  }),
  SHEET_ID,
  TOTAL_HEADER: "Total Rent",
};

/** The canaries inside TEST_ENV's secrets and Sheet id. A screen that shows any of them leaks a setting. */
export const CANARIES = [AUTH_SECRET, AUTH_GOOGLE_SECRET, PRIVATE_KEY, SHEET_ID];

/** The settings the app reads that TEST_ENV leaves out: a test that stubs the environment clears them, so the machine's own do not leak in. */
const UNSET = ["AUTH_URL", "ALLOWED_EMAIL", "SESSION_NOT_BEFORE", "CSP_REPORT_ONLY", "SCHEDULE_TAB", "SETTINGS_TAB", "LOG_TAB", "TENANTS_TAB", "TENANCY_LOG_TAB"];

/** Sets the process's settings to TEST_ENV (and `overrides`; undefined clears one), for the pages that read them. Undo it with `vi.unstubAllEnvs()`. */
export function stubTestEnv(overrides: Record<string, string | undefined> = {}): void {
  for (const name of UNSET) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries({ ...TEST_ENV, ...overrides })) vi.stubEnv(name, value);
}

/**
 * The Sheets context of a screen: a world by name (on `options.now`, FIXED_NOW unless said), or the tabs a test made, in an
 * in-memory gateway, built by the app's own `buildSheetsContext` from TEST_ENV, so the named tabs, the caches and the parsing
 * are the real ones. `options.faults` makes methods of the gateway fail (see `withFaults`); the object is kept, so a test may
 * change it after the first read. `fake` is the Sheet itself: its tabs are what a write would have changed and its `calls`
 * what the page asked for.
 */
export function screenContext(
  source: WorldName | Tabs,
  options: { faults?: Faults; now?: Date } = {},
): { ctx: SheetsContext; fake: FakeGateway } {
  const tabs = typeof source === "string" ? world(source, options.now ?? FIXED_NOW).tabs : source;
  const fake = new FakeGateway(tabs);
  const ctx = buildSheetsContext(readEnv(TEST_ENV), withFaults(fake, options.faults ?? noFaults()));
  return { ctx, fake };
}

/** The markup of what a server component returned (`renderScreen(await Page(props))`), the way the server sends it. */
export function renderScreen(page: ReactNode): string {
  return renderToStaticMarkup(createElement(() => page));
}

/**
 * What every render of every screen has to be: it passes the landmark rules (see landmarks.ts, `main: false` for a piece of a
 * page), has no button or link under 44 px, and shows none of the CANARIES. Fails the test when it is not; returns the markup.
 */
export function expectSound(html: string, options: { main?: boolean } = {}): string {
  expect(landmarkProblems(html, options)).toEqual([]);
  expect(smallTargets(html)).toEqual([]);
  for (const canary of CANARIES) expect(html).not.toContain(canary);
  return html;
}
