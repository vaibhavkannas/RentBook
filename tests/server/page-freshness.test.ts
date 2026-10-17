import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { unavailable } from "@/lib/errors";

// Every page that reads the Sheet asks for data no older than its viewer's own last write, and names the viewer
// when it asks: the write-time cookie is signed for one person (see freshness.ts).

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  loadMonthView: vi.fn(),
  readWrittenAt: vi.fn(),
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
  readWrittenAt: mocks.readWrittenAt,
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

/** Renders a page's first output; the data layer fails, so the page only shows its problem message. */
async function render(page: Promise<unknown>) {
  const element = (await page) as ReactElement;
  return renderToStaticMarkup(createElement(() => element));
}

let log: MockInstance<typeof console.error>;
beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
  mocks.readWrittenAt.mockResolvedValue(1_800_000_000_000);
  for (const mock of [mocks.loadMonthView, mocks.readActivity, mocks.getSettings, mocks.getPortionTenants]) {
    mock.mockRejectedValue(unavailable());
  }
});
afterEach(() => log.mockRestore());

describe("pages and the write-time cookie", () => {
  it("the month view is loaded for the signed-in person", async () => {
    await render(Home({ searchParams: Promise.resolve({ month: "2026-10" }) }));
    expect(mocks.loadMonthView).toHaveBeenCalledWith(expect.anything(), { year: 2026, month: 10 }, "owner@example.com");
  });

  it("the Activity page asks for data no older than the person's own last write", async () => {
    await render(ActivityPage());
    expect(mocks.readWrittenAt).toHaveBeenCalledWith("owner@example.com");
    expect(mocks.readActivity).toHaveBeenCalledWith(expect.anything(), undefined, { minFetchedAt: 1_800_000_000_000 });
  });

  it("the Activity page asks for no minimum when the person has not written lately", async () => {
    mocks.readWrittenAt.mockResolvedValue(undefined);
    await render(ActivityPage());
    expect(mocks.readActivity).toHaveBeenCalledWith(expect.anything(), undefined, { minFetchedAt: undefined });
  });

  it("the Settings page asks for data no older than the owner's own last write", async () => {
    await render(SettingsPage());
    expect(mocks.readWrittenAt).toHaveBeenCalledWith("owner@example.com");
    expect(mocks.getSettings).toHaveBeenCalledWith(expect.anything(), { minFetchedAt: 1_800_000_000_000 });
  });

  it("the tenant page asks for data no older than the person's own last write", async () => {
    mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
    await render(TenantsPage({ params: Promise.resolve({ portionId: "p1" }), searchParams: Promise.resolve({}) }));
    expect(mocks.readWrittenAt).toHaveBeenCalledWith("member@example.com");
    expect(mocks.getPortionTenants).toHaveBeenCalledWith(expect.anything(), "p1", { minFetchedAt: 1_800_000_000_000 });
  });
});
