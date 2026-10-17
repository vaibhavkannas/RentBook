import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { configError, rateLimited, sheetStructure, unavailable } from "@/lib/errors";

// What each page that reads the Sheet tells a person when the read fails, for the owner and for a member.

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  loadMonthView: vi.fn(),
  readActivity: vi.fn(),
  getSettings: vi.fn(),
  getPortionTenants: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({
  loadMonthView: mocks.loadMonthView,
  readWrittenAt: vi.fn(async () => undefined),
}));
vi.mock("@/lib/sheets/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/service")>()),
  readActivity: mocks.readActivity,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/sheets/tenancy-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/tenancy-service")>()),
  getPortionTenants: mocks.getPortionTenants,
}));

import ActivityPage from "@/app/activity/page";
import Home from "@/app/page";
import SettingsPage from "@/app/settings/page";
import LoadProblem from "@/components/LoadProblem";
import TenantsPage from "@/app/tenants/[portionId]/page";

const DETAIL = "Google rejected the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT_JSON.";
const SHORT = "The Sheet connection needs attention. Ask the owner.";

const html = async (page: Promise<unknown>) => {
  const element = (await page) as ReactElement;
  return renderToStaticMarkup(createElement(() => element));
};

const pages: [string, () => Promise<string>, mock: ReturnType<typeof vi.fn>][] = [
  ["the home page", () => html(Home({ searchParams: Promise.resolve({ month: "2026-10" }) })), mocks.loadMonthView],
  ["the Activity page", () => html(ActivityPage()), mocks.readActivity],
  [
    "the tenant page",
    () => html(TenantsPage({ params: Promise.resolve({ portionId: "p1" }), searchParams: Promise.resolve({}) })),
    mocks.getPortionTenants,
  ],
];

const asOwner = () => mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
const asMember = () => mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });

let log: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  asMember();
});
afterEach(() => log.mockRestore());

describe.each(pages)("%s, when the Sheet connection is broken", (_name, render, mock) => {
  it("shows the owner what is wrong", async () => {
    asOwner();
    mock.mockRejectedValue(configError(DETAIL));
    const out = await render();
    expect(out).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(out).not.toContain(SHORT);
  });

  it("tells a member only to ask the owner, and keeps the detail in the server log", async () => {
    mock.mockRejectedValue(configError(DETAIL));
    const out = await render();
    expect(out).toContain(SHORT);
    expect(out).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(log.mock.calls.flat().join(" ")).toContain(DETAIL);
  });

  it("tells everyone in plain words when Google is limiting requests or not responding", async () => {
    mock.mockRejectedValue(rateLimited());
    expect(await render()).toContain("Google is limiting requests right now. Wait a minute and try again.");
    mock.mockRejectedValue(unavailable());
    expect(await render()).toContain("Google isn&#x27;t responding. Try again in a minute.");
  });

  it("still tells a member what is wrong with the Sheet's own structure", async () => {
    mock.mockRejectedValue(sheetStructure('The tab "Tenants" was not found in your Sheet.'));
    expect(await render()).toContain("The tab &quot;Tenants&quot; was not found in your Sheet.");
  });

  it("says it could not reach Google for any other failure, and logs it", async () => {
    mock.mockRejectedValue(new Error("secret internals"));
    const out = await render();
    expect(out).toContain("Couldn&#x27;t reach Google Sheets. Try again.");
    expect(out).not.toContain("secret internals");
    expect(log).toHaveBeenCalled();
  });
});

describe("the settings page, which only the owner sees", () => {
  it("shows the owner what is wrong", async () => {
    asOwner();
    mocks.getSettings.mockRejectedValue(configError(DETAIL));
    expect(await html(SettingsPage())).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });

  it("keeps a member out", async () => {
    await expect(SettingsPage()).rejects.toThrow("redirect:/");
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });
});

describe("the settings page, when the Sheet cannot be read", () => {
  it("shows the problem as the same block the other pages show, with a way to try again", async () => {
    asOwner();
    mocks.getSettings.mockRejectedValue(rateLimited());
    const out = await html(SettingsPage());
    expect(out).toContain("Google is limiting requests right now. Wait a minute and try again.");
    expect(out).toContain("Can&#x27;t load your Sheet");
    expect(out).toMatch(/<a [^>]*href="\/settings"[^>]*>Try again<\/a>/);
    expect(out).toContain('role="alert"');
  });
});

describe("LoadProblem, with a way to Set up", () => {
  const render = (props: { setupHref?: string }) =>
    renderToStaticMarkup(createElement(LoadProblem, { message: "Google rejected the key.", retryHref: "/activity", ...props }));

  it("shows only Try again when it is not given Set up, as it always did", () => {
    const out = render({});
    expect(out).toMatch(/<a [^>]*href="\/activity"[^>]*>Try again<\/a>/);
    expect(out).not.toContain("Set up");
    expect(out).not.toContain("flex-wrap");
  });

  it("shows a second link, to Set up, with what it is for", () => {
    const out = render({ setupHref: "/setup?month=2026-10" });
    expect(out).toMatch(/<a [^>]*href="\/activity"[^>]*>Try again<\/a>/);
    expect(out).toMatch(/<a [^>]*href="\/setup\?month=2026-10"[^>]*>Open Set up to see what is wrong<\/a>/);
    for (const tag of out.match(/<a [^>]*>/g) ?? []) expect(tag).toContain("min-h-11");
  });
});

describe.each(pages)("%s: the link to Set up", (_name, render, mock) => {
  const SETUP = /<a [^>]*href="\/setup[^"]*"[^>]*>Open Set up to see what is wrong<\/a>/;

  it("is shown to the owner when the connection is broken, and when the Sheet's structure is", async () => {
    asOwner();
    mock.mockRejectedValue(configError(DETAIL));
    expect(await render()).toMatch(SETUP);
    mock.mockRejectedValue(sheetStructure("The Schedule tab has no month rows to copy the format from."));
    expect(await render()).toMatch(SETUP);
  });

  it("is not shown to a member, who is told to ask the owner", async () => {
    mock.mockRejectedValue(configError(DETAIL));
    expect(await render()).not.toContain("Set up");
    mock.mockRejectedValue(sheetStructure("The Schedule tab has no month rows to copy the format from."));
    expect(await render()).not.toContain("Set up");
  });

  it("is not shown to the owner for a problem Set up cannot explain", async () => {
    asOwner();
    for (const error of [rateLimited(), unavailable(), new Error("secret internals")]) {
      mock.mockRejectedValue(error);
      expect(await render(), String(error)).not.toContain("Set up");
    }
  });
});

describe("the link to Set up carries the month, and the settings page has it too", () => {
  it("keeps the month of the home page and of the settings page in the link", async () => {
    asOwner();
    mocks.loadMonthView.mockRejectedValue(configError(DETAIL));
    expect(await html(Home({ searchParams: Promise.resolve({ month: "2026-10" }) }))).toMatch(/href="\/setup\?month=2026-10"/);
    mocks.getSettings.mockRejectedValue(configError(DETAIL));
    expect(await html(SettingsPage({ searchParams: Promise.resolve({ month: "2026-09" }) }))).toMatch(/href="\/setup\?month=2026-09"/);
    expect(await html(SettingsPage())).toMatch(/href="\/setup"/);
  });

  it("is on the tenant page too when the Tenants tab cannot be used, for the owner only", async () => {
    mocks.getPortionTenants.mockResolvedValue({
      portion: { id: "p1", name: "Ground floor" },
      scheduleTenant: null,
      current: null,
      mismatched: null,
      past: [],
      tenantsProblem: "The Tenants tab must have a Phone column.",
    });
    const page = () => html(TenantsPage({ params: Promise.resolve({ portionId: "p1" }), searchParams: Promise.resolve({}) }));
    asOwner();
    expect(await page()).toMatch(/href="\/setup"[^>]*>Open Set up to see what is wrong</);
    asMember();
    expect(await page()).not.toContain("Set up");
  });
});
