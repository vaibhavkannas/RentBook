import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import { LAYOUT_RULES } from "@/lib/layout-rules";
import { configError } from "@/lib/errors";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import { LOG_HEADERS, LOG_TAB, SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { TENANT_HEADERS, TENANTS_TAB } from "@/lib/sheets/tenants-store";
import { captureLogs, type LogSpies } from "../support/logs";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid } from "../support/fixtures";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// The Set up page: the owner's guided check of the connection between the app and the Google Sheet, with the one button
// (Prepare my Sheet) that changes anything. A stranger is sent to sign in and a member is told it is the owner's.

const nav = vi.hoisted(() => ({ search: "" }));
const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getSheetsContext: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/setup",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: mocks.getSheetsContext }));

import SetupPage, { maxDuration } from "@/app/setup/page";

async function render(): Promise<string> {
  const page = (await SetupPage()) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

/** The text a person reads, without the markup. */
const visibleText = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const EMAIL = "rentbook-robot@example-project.iam.gserviceaccount.com";
const KEY = JSON.stringify({
  type: "service_account",
  client_email: EMAIL,
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIE-fake\n-----END PRIVATE KEY-----\n",
});
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
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_URL",
  "ALLOWED_EMAILS",
  "ALLOWED_EMAIL",
  "SESSION_NOT_BEFORE",
  "CSP_REPORT_ONLY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "SHEET_ID",
  "SCHEDULE_TAB",
  "TOTAL_HEADER",
  "SETTINGS_TAB",
  "LOG_TAB",
  "TENANTS_TAB",
];

let saved: Record<string, string | undefined>;
let logs: LogSpies;
function setEnv(values: Record<string, string | undefined>) {
  for (const name of SETTING_NAMES) delete process.env[name];
  for (const [name, value] of Object.entries(values)) if (value !== undefined) process.env[name] = value;
}

const tenantRow = (): unknown[] => [
  "t-1", "p1", "Asha", "98765 43210", "2026-01-15", "2027-01-14", 20000, "2026-01-10", "Held", "", "", "Paid by cheque", "", "owner@example.com", "2026-01-15T05:00:00.000Z",
];

const healthy = () =>
  new FakeGateway({
    Schedule: baseSchedule(),
    [SETTINGS_TAB]: settingsGrid(),
    [LOG_TAB]: [[...LOG_HEADERS]],
    [TENANTS_TAB]: [[...TENANT_HEADERS], tenantRow()],
  });
const fresh = () => new FakeGateway({ Schedule: baseSchedule() });

const serveSheet = (gateway: FakeGateway | NamedTabsGateway, totalHeader: string | null = "Total Rent") =>
  mocks.getSheetsContext.mockReturnValue({ gateway, scheduleTab: "Schedule", totalHeader });

const asOwner = () => mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
const asMember = () => mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });

beforeEach(() => {
  vi.clearAllMocks();
  logs = captureLogs();
  saved = Object.fromEntries(SETTING_NAMES.map((name) => [name, process.env[name]]));
  setEnv(ENV);
  nav.search = "";
  asOwner();
  serveSheet(healthy());
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("who sees the Set up page", () => {
  it("sends a person who is not signed in to the sign-in page, and runs no check", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
    expect(mocks.getSheetsContext).not.toHaveBeenCalled();
  });

  it("tells a member it is for the owner, shows no check, and reads nothing", async () => {
    asMember();
    const html = await render();
    expect(html).toContain('<h1 class="text-lg font-semibold">Set up</h1>');
    expect(visibleText(html)).toContain("Set up is for the owner. If something isn't working, ask the owner to open it.");
    expect(html).toMatch(/<a [^>]*href="\/more"[^>]*>‹<\/a>/);
    expect(mocks.getSheetsContext).not.toHaveBeenCalled();
    expect(html).not.toContain("AUTH_SECRET");
    expect(html).not.toContain("Prepare my Sheet");
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain("<h2");
  });

  it("exports the time limit every page that reads the Sheet has", () => {
    expect(maxDuration).toBe(15);
  });
});

describe("the owner's view of a connected Sheet", () => {
  it("is titled Set up, with an arrow back to More that keeps the month", async () => {
    nav.search = "month=2026-10";
    const html = await render();
    expect(html).toContain('<h1 class="text-lg font-semibold">Set up</h1>');
    expect(html).toMatch(/<a [^>]*href="\/more\?month=2026-10"[^>]*>‹<\/a>/);
    expect(html).toContain('aria-label="Back to More"');
  });

  it("says what the page does, and that it only reads", async () => {
    const text = visibleText(await render());
    expect(text).toContain(
      "This page checks each part of the connection between RentBook and your Google Sheet. It only reads: nothing in your Sheet changes unless you tap Prepare my Sheet.",
    );
  });

  it("says everything is connected, in a success notice", async () => {
    const html = await render();
    expect(html).toMatch(/<p role="status" class="[^"]*\bbg-success-bg\b[^"]*"[^>]*>Everything is connected\.<\/p>/);
  });

  it("has a card for each of the six steps, in order, each with its status", async () => {
    const html = await render();
    const headings = [...html.matchAll(/<h2 id="step-(\d)"[^>]*>([^<]*)<\/h2><span class="[^"]*">([^<]*)<\/span>/g)].map((m) => [
      m[1],
      m[2].replace(/&#x27;/g, "'"),
      m[3],
    ]);
    expect(headings).toEqual([
      ["1", "1. Sign-in", "OK"],
      ["2", "2. Google service account", "OK"],
      ["3", "3. Your Sheet", "OK"],
      ["4", "4. Schedule tab", "OK"],
      ["5", "5. RentBook's tabs", "OK"],
      ["6", "6. Portion settings", "OK"],
    ]);
  });

  it("shows each check with its title, its status and what it found, and only the service account's address of anything in the environment", async () => {
    const text = visibleText(await render());
    for (const part of [
      "AUTH_SECRET OK Set.",
      "ALLOWED_EMAILS OK 2 addresses. The first is the owner.",
      `GOOGLE_SERVICE_ACCOUNT_JSON OK Set. The service account is ${EMAIL}.`,
      "SHEET_ID OK Set.",
      "Opening your Sheet OK RentBook can open your Sheet (",
      'Found the tab "Schedule".',
      "Headers are in row 3.",
      '2 month rows, August 2026 to September 2026, written as text such as "Sep-26".',
      'Column "Total Rent" adds itself up with a formula.',
      "5 portions, each with its Tenant, Count and Amount columns.",
      "Headers are right. 0 entries.",
      "Headers are right. 1 row.",
    ]) {
      expect(text, part).toContain(part);
    }
  });

  it("has no Prepare my Sheet card when there is nothing to prepare", async () => {
    const html = await render();
    expect(html).not.toContain("Prepare my Sheet</button>");
    expect(html).not.toContain("prepare-heading");
  });

  it("closes with the step 6 reminder, and a link to the portion settings now that Settings is there", async () => {
    const html = await render();
    const step = html.slice(html.indexOf('id="step-6"'));
    expect(visibleText(step)).toContain(
      "Set each portion's payments per cycle (or Count never resets) and hike before the first payment: the app cannot change a payment count later.",
    );
    expect(step).toMatch(/<a [^>]*href="\/settings"[^>]*>Open Portion settings<\/a>/);
  });

  it("lists what the Sheet needs, in a closed section, one rule for each part", async () => {
    const html = await render();
    const details = /<details[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1] ?? "";
    expect(details).toMatch(/<summary[^>]*>What your Sheet needs<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    for (const { topic, text } of LAYOUT_RULES) {
      expect(visibleText(details), topic).toContain(topic);
      expect(visibleText(details), topic).toContain(visibleText(text).slice(0, 40));
    }
  });

  it("ends with a Check again link to this page", async () => {
    const html = await render();
    expect(html).toMatch(/<a [^>]*href="\/setup"[^>]*>Check again<\/a>/);
  });

  it("makes room for the tab bar, and has every tap target at least 44 px, with press feedback", async () => {
    const html = await render();
    expect(html).toMatch(/^<main class="[^"]*\bpb-tabbar\b/);
    expect(smallTargets(html)).toEqual([]);
    expect(unpressedTargets(html)).toEqual([]);
  });

  it("uses no script or style of its own", async () => {
    const html = await render();
    expect(html).not.toMatch(/<script|<style/);
  });
});

describe("a Sheet that is not set up yet", () => {
  beforeEach(() => serveSheet(fresh()));

  it("says the Sheet needs preparing, in a notice that is not the success one", async () => {
    const html = await render();
    expect(html).toMatch(/<p role="status" class="[^"]*\bbg-warn-bg\b[^"]*"[^>]*>Your Sheet needs preparing\.<\/p>/);
    expect(html).not.toContain("bg-success-bg text-success-ink\">Your Sheet");
  });

  it("offers Prepare my Sheet, and says what it adds and what Settings starts with", async () => {
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain(
      "Adds the missing tabs (Settings, Payments Log and Tenants) with their headers. Nothing already in your Sheet is changed.",
    );
    expect(text).toContain(
      "Settings starts with 5 portions from your Schedule header, each with 11 payments per cycle and a 5% hike. Check them in Portion settings before the first payment.",
    );
    expect(html).toMatch(/<button type="button" class="[^"]*\bmin-h-12\b[^"]*"[^>]*>Prepare my Sheet<\/button>/);
    expect(html).toContain('<div role="status"></div>');
  });

  it("shows the three tabs and the reminder as to do, and no link to the portion settings yet", async () => {
    const html = await render();
    const step5 = html.slice(html.indexOf('id="step-5"'), html.indexOf('id="step-6"'));
    expect(step5.match(/>To do</g)).toHaveLength(4);
    const step6 = html.slice(html.indexOf('id="step-6"'));
    expect(step6).not.toContain('href="/settings"');
    expect(visibleText(step6)).toContain("the app cannot change a payment count later.");
  });

  it("changes nothing in the Sheet, however often it is looked at", async () => {
    const fake = fresh();
    serveSheet(fake);
    const before = structuredClone([...fake.tabs.entries()]);
    await render();
    await render();
    for (const write of ["addTab", "updateValues", "appendRow", "cloneRow"]) expect(fake.calls).not.toContain(write);
    expect([...fake.tabs.entries()]).toEqual(before);
  });

  it("has every tap target at least 44 px, with press feedback, the button included", async () => {
    const html = await render();
    expect(html).toContain("Prepare my Sheet</button>");
    expect(smallTargets(html)).toEqual([]);
    expect(unpressedTargets(html)).toEqual([]);
  });

  it("does not offer it while the Schedule has a problem to fix first", async () => {
    const schedule = baseSchedule();
    schedule[2][0] = "When";
    serveSheet(new FakeGateway({ Schedule: schedule }));
    const html = await render();
    expect(html).not.toContain("Prepare my Sheet</button>");
    expect(html).toMatch(/>1 thing to fix\.<\/p>/);
    expect(visibleText(html)).toContain('No row with "Month" in the first 25 rows.');
  });

  it("does not offer it while the Sheet cannot be reached", async () => {
    const fake = fresh();
    vi.spyOn(fake, "listTabs").mockRejectedValue(configError("Share the Sheet with the service account as an Editor."));
    serveSheet(fake);
    const html = await render();
    expect(html).not.toContain("Prepare my Sheet</button>");
    expect(visibleText(html)).toContain("Share the Sheet with the service account as an Editor.");
    expect(html.match(/Waiting for the checks above\./g)).toHaveLength(9);
  });

  it("says to rename a tab first when the owner has named one that is not in the Sheet", async () => {
    setEnv({ ...ENV, SETTINGS_TAB: "My Settings" });
    serveSheet(new NamedTabsGateway(fresh(), { schedule: "Schedule", settings: "My Settings", log: LOG_TAB, tenants: TENANTS_TAB }));
    const text = visibleText(await render());
    expect(text).toContain("Adds the missing tabs (My Settings, Payments Log and Tenants)");
    expect(text).toContain(
      "You gave SETTINGS_TAB a name that is not in your Sheet yet. If you already have that tab under another name, rename it in your Sheet first, then use Check again",
    );
    expect(text).toContain('You set SETTINGS_TAB to "My Settings". If you already have this tab under another name, rename it to "My Settings" in your Sheet first');
  });
});

describe("settings that are wrong", () => {
  it("says what to fix, in the steps they belong to, and that the Sheet's checks are waiting", async () => {
    setEnv({ ...ENV, SHEET_ID: undefined });
    mocks.getSheetsContext.mockImplementation(() => {
      throw configError("Missing environment variables: SHEET_ID.");
    });
    const html = await render();
    expect(visibleText(html)).toContain("SHEET_ID Fix Not set.");
    expect(visibleText(html)).toContain("To fix: Copy the ID from the Sheet's address (SETUP.md step 1).");
    expect(html.match(/Fix the settings above first\./g)).toHaveLength(10);
    expect(html).toMatch(/>1 thing to fix\.<\/p>/);
    expect(html).not.toContain("Prepare my Sheet</button>");
    expect(logs.error).not.toHaveBeenCalled();
  });

  it("counts every problem the environment has", async () => {
    setEnv({});
    mocks.getSheetsContext.mockImplementation(() => {
      throw configError("Missing environment variables.");
    });
    expect(await render()).toMatch(/>6 things to fix\.<\/p>/);
  });

  it("logs, and does not say, a failure to start the connection that is not a config error", async () => {
    mocks.getSheetsContext.mockImplementation(() => {
      throw new Error("something CANARY broke");
    });
    const html = await render();
    expect(html).not.toContain("CANARY");
    expect(html.match(/Fix the settings above first\./g)).toHaveLength(10);
    expect(logs.error).toHaveBeenCalledOnce();
  });

  it("shows a warning when a setting works but is worth a look, and still checks the Sheet", async () => {
    setEnv({ ...ENV, CSP_REPORT_ONLY: "1" });
    const html = await render();
    expect(visibleText(html)).toContain("On: the browser only reports what the security policy would block.");
    expect(visibleText(html)).toContain("To fix: Delete it and redeploy once the problem is fixed.");
    expect(html).toMatch(/>1 thing to fix\.<\/p>/);
    expect(html).toMatch(/<p role="status" class="[^"]*\bbg-warn-bg\b/);
    expect(visibleText(html)).toContain("5 portions, each with its Tenant, Count and Amount columns.");
  });
});

describe("the real titles of the tabs", () => {
  it("are shown beside what was found where they are not the usual names", async () => {
    const inner = new FakeGateway({
      schedule: baseSchedule(),
      settings: settingsGrid(),
      "payments log": [[...LOG_HEADERS]],
      "RentBook Tenants": [[...TENANT_HEADERS], tenantRow()],
      Tenants: [["somebody else's tab"]],
    });
    setEnv({ ...ENV, TENANTS_TAB: "RentBook Tenants" });
    serveSheet(new NamedTabsGateway(inner, { schedule: "Schedule", settings: SETTINGS_TAB, log: LOG_TAB, tenants: "RentBook Tenants" }));
    const text = visibleText(await render());
    expect(text).toContain('Found the tab "schedule".');
    expect(text).toContain('Found as "payments log". Headers are right. 0 entries.');
    expect(text).toContain('Found as "RentBook Tenants". Headers are right. 1 row.');
    expect(text).not.toContain("somebody else's tab");
  });
});

describe("what the page never shows", () => {
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
    return new FakeGateway({
      Schedule: schedule,
      [SETTINGS_TAB]: settingsGrid(),
      [LOG_TAB]: [[...LOG_HEADERS], ["2026-08-05T04:30:00.000Z", "2026-08", "p1", tenant, Number(amount), 2, "2026-08-05", owner, "Logged"]],
      [TENANTS_TAB]: [[...TENANT_HEADERS], row],
    });
  }

  const env = {
    AUTH_SECRET: secret,
    AUTH_GOOGLE_ID: googleId,
    AUTH_GOOGLE_SECRET: googleSecret,
    ALLOWED_EMAILS: `${owner}, member@example.com`,
    SESSION_NOT_BEFORE: "2031-01-01T00:00:00Z",
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: project, private_key: privateKey, client_email: CANARY_EMAIL }),
    SHEET_ID: sheetId,
    TOTAL_HEADER: "Total Rent",
  };

  it("holds no secret, key, setting or tenant data, whatever the settings and the Sheet hold; only the service account's address", async () => {
    for (const [name, gateway] of [
      ["connected", loadedSheet()],
      ["fresh", new FakeGateway({ Schedule: loadedSheet().tabs.get("Schedule")! })],
    ] as const) {
      setEnv(env);
      serveSheet(gateway);
      const html = await render();
      expect(html, name).toContain(CANARY_EMAIL);
      const rest = html.replaceAll(CANARY_EMAIL, "");
      for (const canary of [...CANARIES, "CANARY", "2031", "BEGIN PRIVATE KEY", "MIIE"]) expect(rest, `${name}: ${canary}`).not.toContain(canary);
    }
  });

  it("holds none of it when the settings are wrong or the Sheet cannot be read either", async () => {
    setEnv({ ...env, GOOGLE_SERVICE_ACCOUNT_JSON: `{not json ${privateKey}`, SHEET_ID: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, AUTH_SECRET: "CANARY-short" });
    mocks.getSheetsContext.mockImplementation(() => {
      throw configError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    });
    const html = await render();
    for (const canary of [...CANARIES, "CANARY"]) expect(html, canary).not.toContain(canary);

    setEnv(env);
    const broken = loadedSheet();
    broken.tabs.get(TENANTS_TAB)![0][3] = "Mobile";
    broken.tabs.get(SETTINGS_TAB)![2][2] = "Tenant9";
    serveSheet(broken);
    const second = await render();
    for (const canary of [...CANARIES, "CANARY"]) expect(second.replaceAll(CANARY_EMAIL, ""), canary).not.toContain(canary);
  });

  it("does not print the version, the host or the Sheet's address", async () => {
    const html = await render();
    expect(html).not.toContain("Version");
    expect(html).not.toContain(pkg.version);
    expect(html).not.toContain("docs.google.com");
    expect(html).not.toContain(ENV.SHEET_ID);
  });
});
