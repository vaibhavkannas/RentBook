import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortionConfig } from "@/lib/domain/types";

// The portion settings page: the owner's, reached from More, with its arrow back to More.

const nav = vi.hoisted(() => ({ search: "" }));
const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getSettings: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ readWrittenAt: async () => undefined }));
vi.mock("@/lib/sheets/service", () => ({ getSettings: mocks.getSettings }));

import SettingsPage from "@/app/settings/page";

const portions: PortionConfig[] = [
  { id: "p1", name: "Ground floor", tenantHeader: "Tenant", countHeader: "Count", amountHeader: "Amount", cycleLength: 11, hikePercent: 5 },
];

async function render(searchParams?: Record<string, string | string[] | undefined>): Promise<string> {
  const page = (await SettingsPage(searchParams ? { searchParams: Promise.resolve(searchParams) } : {})) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
  mocks.getSettings.mockResolvedValue(portions);
});

describe("the portion settings page", () => {
  it("sends a person who is not signed in to the sign-in page, and a member to the month screen", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
    mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
    await expect(render()).rejects.toThrow("redirect:/");
  });

  it("is titled Portion settings, with an arrow back to More", async () => {
    const html = await render();
    expect(html).toContain('<h1 class="text-lg font-semibold">Portion settings</h1>');
    expect(html).toMatch(/<a [^>]*href="\/more"[^>]*>‹<\/a>/);
    expect(html).toContain('aria-label="Back to More"');
    expect(html).not.toContain("Back to month");
  });

  it("has its arrow back to More carry the month of the address", async () => {
    nav.search = "month=2026-10";
    expect(await render()).toMatch(/<a [^>]*href="\/more\?month=2026-10"[^>]*>‹<\/a>/);
  });

  it("shows the form for each portion", async () => {
    const html = await render();
    expect(html).toContain("Settings for Ground floor");
    expect(html).toContain("Save settings");
  });

  it("shows a portion that is switched off in its own section, with a way to switch it on, and gives it no fields", async () => {
    mocks.getSettings.mockResolvedValue([...portions, { ...portions[0], id: "p2", name: "Roof room", inactive: true }]);
    const html = await render();
    expect(html).toContain("Settings for Ground floor");
    expect(html).not.toContain("Settings for Roof room");
    expect(html).toContain("Switched off");
    expect(html).toContain('aria-label="Switch on Roof room"');
    expect(html).toContain("Change order");
    expect(html).toContain("Add a portion");
  });

  it("keeps the month in its Try again link when the Settings tab cannot be read", async () => {
    mocks.getSettings.mockRejectedValue(new Error("down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await render({ month: "2026-10" })).toMatch(/<a [^>]*href="\/settings\?month=2026-10"[^>]*>Try again<\/a>/);
    expect(await render()).toMatch(/<a [^>]*href="\/settings"[^>]*>Try again<\/a>/);
    log.mockRestore();
  });
});
