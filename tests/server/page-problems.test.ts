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
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
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
