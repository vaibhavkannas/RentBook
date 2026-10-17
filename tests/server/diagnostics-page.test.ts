import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import { configError } from "@/lib/errors";
import { formatSavedAt } from "@/lib/format";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import { LOG_HEADERS, LOG_TAB, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { captureLogs } from "../support/logs";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid } from "../support/fixtures";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// The Diagnostics page: how the app and the Sheet are doing, for the owner. A stranger is sent to sign in, a member is
// told it is the owner's, and nothing is read for either.

const nav = vi.hoisted(() => ({ search: "" }));
const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getSheetsContext: vi.fn(),
  problemCounts: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/diagnostics",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: mocks.getSheetsContext }));
vi.mock("@/lib/server/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/log")>()),
  problemCounts: mocks.problemCounts,
}));

import DiagnosticsPage, { maxDuration } from "@/app/diagnostics/page";

async function render(searchParams?: Record<string, string | string[] | undefined>): Promise<string> {
  const page = (await DiagnosticsPage(searchParams ? { searchParams: Promise.resolve(searchParams) } : undefined)) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

const visibleText = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const EMAIL = "rentbook-robot@example-project.iam.gserviceaccount.com";
const KEY = JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nMIIE-fake\n-----END PRIVATE KEY-----\n" });
const ENV: Record<string, string> = {
  AUTH_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
  AUTH_GOOGLE_ID: "client-id.apps.example.com",
  AUTH_GOOGLE_SECRET: "client-secret",
  ALLOWED_EMAILS: "owner@example.com, member@example.com",
  GOOGLE_SERVICE_ACCOUNT_JSON: KEY,
  SHEET_ID: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
  TOTAL_HEADER: "Total Rent",
};
const SETTING_NAMES = [
  "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_URL", "ALLOWED_EMAILS", "ALLOWED_EMAIL", "SESSION_NOT_BEFORE", "CSP_REPORT_ONLY",
  "GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID", "SCHEDULE_TAB", "TOTAL_HEADER", "SETTINGS_TAB", "LOG_TAB", "TENANTS_TAB",
];

let saved: Record<string, string | undefined>;
function setEnv(values: Record<string, string | undefined>) {
  for (const name of SETTING_NAMES) delete process.env[name];
  for (const [name, value] of Object.entries(values)) if (value !== undefined) process.env[name] = value;
}

const tenantRow = (updatedAt = "2026-09-20T08:00:00.000Z", moveOut = ""): unknown[] => [
  "t-1", "p1", "Asha", "98765 43210", "2026-01-15", "2027-01-14", 20000, "2026-01-10", "Held", "", "", "Paid by cheque", moveOut, "owner@example.com", updatedAt,
];
const logRow = (savedAt: string): unknown[] => [savedAt, "2026-09", "p1", "Asha", 5450, 3, "2026-09-05", "owner@example.com", "Logged"];

const healthy = () =>
  new FakeGateway({
    Schedule: baseSchedule(),
    [SETTINGS_TAB]: settingsGrid(),
    [LOG_TAB]: [[...LOG_HEADERS], logRow("2026-08-05T04:30:00.000Z"), logRow("2026-09-07T06:15:00.000Z")],
    [TENANTS_TAB]: [[...TENANT_HEADERS], tenantRow(), tenantRow("2026-06-30T05:00:00.000Z", "2026-06-30")],
  });
const serveSheet = (gateway: FakeGateway | NamedTabsGateway) =>
  mocks.getSheetsContext.mockReturnValue({ gateway, scheduleTab: "Schedule", totalHeader: "Total Rent" });

const asOwner = () => mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
const asMember = () => mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });

beforeEach(() => {
  vi.clearAllMocks();
  captureLogs();
  saved = Object.fromEntries(SETTING_NAMES.map((name) => [name, process.env[name]]));
  setEnv(ENV);
  nav.search = "";
  asOwner();
  serveSheet(healthy());
  mocks.problemCounts.mockReturnValue({ since: "2026-10-16T05:30:00.000Z", warn: {}, error: {} });
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("who sees Diagnostics", () => {
  it("sends a person who is not signed in to the sign-in page, and reads nothing", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
    expect(mocks.getSheetsContext).not.toHaveBeenCalled();
    expect(mocks.problemCounts).not.toHaveBeenCalled();
  });

  it("tells a member it is for the owner, and shows nothing of the app or the Sheet", async () => {
    asMember();
    const html = await render();
    expect(html).toContain('<h1 class="text-lg font-semibold">Diagnostics</h1>');
    expect(visibleText(html)).toContain("Diagnostics are for the owner.");
    expect(html).toMatch(/<a [^>]*href="\/more"[^>]*>‹<\/a>/);
    expect(mocks.getSheetsContext).not.toHaveBeenCalled();
    expect(mocks.problemCounts).not.toHaveBeenCalled();
    for (const text of ["Version", pkg.version, "Reachable", "Tabs", "Problems", EMAIL, "<h2"]) expect(html, text).not.toContain(text);
  });

  it("exports the time limit every page that reads the Sheet has", () => {
    expect(maxDuration).toBe(15);
  });
});

describe("the owner's Diagnostics", () => {
  it("is titled Diagnostics, with an arrow back to More that keeps the month, and room for the tab bar", async () => {
    nav.search = "month=2026-10";
    const html = await render({ month: "2026-10" });
    expect(html).toContain('<h1 class="text-lg font-semibold">Diagnostics</h1>');
    expect(html).toMatch(/<a [^>]*href="\/more\?month=2026-10"[^>]*>‹<\/a>/);
    expect(html).toContain('aria-label="Back to More"');
    expect(html).toMatch(/^<main class="[^"]*\bpb-tabbar\b/);
  });

  it("has a card for each of the four sections, in order", async () => {
    const html = await render();
    expect([...html.matchAll(/<h2 [^>]*>([^<]*)<\/h2>/g)].map((match) => match[1])).toEqual(["App", "Google Sheet", "Tabs", "Problems"]);
  });

  it("says the version, when the server started, and how many checks are OK, with a way to Set up", async () => {
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain(`Version ${pkg.version}`);
    expect(text).toContain("This server started 16 Oct, 11:00 am");
    expect(text).toMatch(/Checks: \d+ of \d+ OK/);
    const checks = /Checks: (\d+) of (\d+) OK/.exec(text)!;
    expect(checks[1]).toBe(checks[2]);
    expect(html).toMatch(/<a [^>]*href="\/setup"[^>]*>Open Set up<\/a>/);
  });

  it("says the Sheet is reachable, and how long it took", async () => {
    const html = await render();
    expect(html).toMatch(/>Reachable<\/span>/);
    expect(visibleText(html)).toMatch(/Answered in \d+ ms \(tab list\) and \d+ ms \(data\)\./);
  });

  it("says what each tab holds", async () => {
    const text = visibleText(await render());
    expect(text).toContain("Schedule: 2 month rows, August 2026 to September 2026");
    expect(text).toContain("Settings: 5 portions on, 0 switched off");
    expect(text).toContain(`Payments Log: 2 entries, last saved ${formatSavedAt("2026-09-07T06:15:00.000Z")}`);
    expect(text).toContain("Tenants: 2 rows, 1 current");
  });

  it("says no problems were logged, and that each server counts on its own", async () => {
    const text = visibleText(await render());
    expect(text).toContain("No problems logged since 16 Oct, 11:00 am.");
    expect(text).toContain("Each server instance counts on its own and starts from zero when it restarts.");
  });

  it("says how many errors and warnings this server has logged, and by which codes, and nothing more", async () => {
    mocks.problemCounts.mockReturnValue({ since: "2026-10-16T05:30:00.000Z", warn: { "rate-limited": 3 }, error: { config: 1 } });
    const text = visibleText(await render());
    expect(text).toContain("Since 16 Oct, 11:00 am on this server: 1 error, 3 warnings (rate-limited 3, config 1).");
  });

  it("ends with a Check again link to this page, in the month the person was looking at", async () => {
    expect(await render()).toMatch(/<a [^>]*href="\/diagnostics"[^>]*>Check again<\/a>/);
    const html = await render({ month: "2026-10" });
    expect(html).toMatch(/<a [^>]*href="\/diagnostics\?month=2026-10"[^>]*>Check again<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/setup\?month=2026-10"[^>]*>Open Set up<\/a>/);
  });

  it("has every tap target at least 44 px, with press feedback, and no script or style of its own", async () => {
    const html = await render();
    expect(smallTargets(html)).toEqual([]);
    expect(unpressedTargets(html)).toEqual([]);
    expect(html).not.toMatch(/<script|<style/);
  });

  it("changes nothing in the Sheet, however often it is looked at", async () => {
    const fake = healthy();
    serveSheet(fake);
    const before = structuredClone([...fake.tabs.entries()]);
    await render();
    await render();
    for (const write of ["addTab", "updateValues", "appendRow", "cloneRow"]) expect(fake.calls).not.toContain(write);
    expect([...fake.tabs.entries()]).toEqual(before);
  });
});

describe("Diagnostics when the Sheet is not as it should be", () => {
  it("says the Sheet is not reachable, with the reason, and that the tabs were not read", async () => {
    const fake = healthy();
    vi.spyOn(fake, "listTabs").mockRejectedValue(configError("Share the Sheet with the service account as an Editor."));
    serveSheet(fake);
    const html = await render();
    expect(html).toMatch(/>Not reachable<\/span>/);
    const text = visibleText(html);
    expect(text).toContain("Share the Sheet with the service account as an Editor.");
    expect(text).toContain("Schedule: not read");
    expect(text).toContain("Tenants: not read");
  });

  it("says the Sheet was not tried, and points to Set up, when the settings are too wrong to open it", async () => {
    setEnv({ ...ENV, SHEET_ID: undefined });
    mocks.getSheetsContext.mockImplementation(() => {
      throw configError("Missing environment variables: SHEET_ID.");
    });
    const html = await render();
    expect(html).toMatch(/>Not reachable<\/span>/);
    expect(visibleText(html)).toContain("The settings need fixing before the Sheet can be tried.");
    expect(html.match(/>Open Set up<\/a>/g)).toHaveLength(2);
    expect(visibleText(html)).toMatch(/Checks: \d+ of \d+ OK/);
  });

  it("says Not created yet for the tabs a new Sheet does not have", async () => {
    serveSheet(new FakeGateway({ Schedule: baseSchedule() }));
    const text = visibleText(await render());
    expect(text).toContain("Settings: Not created yet");
    expect(text).toContain("Payments Log: Not created yet");
    expect(text).toContain("Tenants: Not created yet");
  });

  it("shows the real title of a tab that has another name, and says to rename a named tab that is not there yet", async () => {
    const inner = new FakeGateway({
      schedule: baseSchedule(),
      settings: settingsGrid(),
      [LOG_TAB]: [[...LOG_HEADERS]],
    });
    setEnv({ ...ENV, TENANTS_TAB: "RentBook Tenants" });
    serveSheet(new NamedTabsGateway(inner, { schedule: "Schedule", settings: SETTINGS_TAB, log: LOG_TAB, tenants: "RentBook Tenants" }));
    const text = visibleText(await render());
    expect(text).toContain('Schedule ("schedule"): 2 month rows');
    expect(text).toContain('Settings ("settings"): 5 portions on');
    expect(text).toContain("Tenants: Not created yet");
    expect(text).toContain("TENANTS_TAB names a tab that is not in your Sheet yet. If you already have it under another name, rename it in your Sheet first (see Set up).");
  });
});

describe("what Diagnostics never shows", () => {
  const CANARIES = [
    "CANARY-auth-secret-0123456789-0123456789",
    "CANARY-google-id",
    "CANARY-google-secret",
    "canary-owner@example.com",
    "CANARY-sheet-id",
    "CANARY-private-key-material",
    "canary-project-id",
    "CANARY-tenant-name",
    "98700 CANARY phone",
    "7654321",
    "CANARY-note",
  ];
  const [secret, googleId, googleSecret, owner, sheetId, privateKey, project, tenant, phone, amount, note] = CANARIES;
  const CANARY_EMAIL = "robot@canary-account.iam.gserviceaccount.com";

  function loadedSheet(): FakeGateway {
    const schedule = baseSchedule();
    schedule[3][1] = tenant;
    schedule[3][3] = Number(amount);
    const row = tenantRow();
    row[2] = tenant;
    row[3] = phone;
    row[6] = Number(amount);
    row[11] = note;
    row[13] = owner;
    return new FakeGateway({
      Schedule: schedule,
      [SETTINGS_TAB]: settingsGrid(),
      [LOG_TAB]: [[...LOG_HEADERS], ["2026-08-05T04:30:00.000Z", "2026-08", "p1", tenant, Number(amount), 2, "2026-08-05", owner, "Logged"]],
      [TENANTS_TAB]: [[...TENANT_HEADERS], row],
    });
  }

  // The tab settings (SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB, TENANTS_TAB) are left out of these canaries on purpose: the Sheet checks
  // show the name of a tab and "Found as ..." by design (tab titles are allowed on this page), so a canary there would be seen.
  // The environment checks never print them, which tests/server/setup-env.test.ts pins with a canary in every tab setting.
  const env = {
    AUTH_SECRET: secret,
    AUTH_GOOGLE_ID: googleId,
    AUTH_GOOGLE_SECRET: googleSecret,
    ALLOWED_EMAILS: `${owner}, member@example.com`,
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: project, private_key: privateKey, client_email: CANARY_EMAIL }),
    SHEET_ID: sheetId,
    TOTAL_HEADER: "Total Rent",
  };

  it("holds no secret, key, setting or tenant data, whatever the Sheet holds", async () => {
    for (const gateway of [loadedSheet(), new FakeGateway({ Schedule: loadedSheet().tabs.get("Schedule")! })]) {
      setEnv(env);
      serveSheet(gateway);
      const html = await render();
      for (const canary of [...CANARIES, "CANARY", "BEGIN PRIVATE KEY", "MIIE", CANARY_EMAIL]) expect(html, canary).not.toContain(canary);
    }
  });

  it("holds none of it when the Sheet cannot be opened or a part of it is wrong", async () => {
    setEnv(env);
    const broken = loadedSheet();
    broken.tabs.get(TENANTS_TAB)![0][3] = "Mobile";
    broken.tabs.get(SETTINGS_TAB)![2][2] = "Tenant9";
    serveSheet(broken);
    for (const canary of [...CANARIES, "CANARY"]) expect(await render(), canary).not.toContain(canary);
    mocks.getSheetsContext.mockImplementation(() => {
      throw configError("x");
    });
    for (const canary of [...CANARIES, "CANARY"]) expect(await render(), canary).not.toContain(canary);
  });

  it("does not print the service account's address, the Sheet's address or any message the server logged", async () => {
    mocks.problemCounts.mockReturnValue({ since: "2026-10-16T05:30:00.000Z", warn: {}, error: { config: 1 } });
    const html = await render();
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain(ENV.SHEET_ID);
    expect(html).not.toContain("docs.google.com");
  });
});
