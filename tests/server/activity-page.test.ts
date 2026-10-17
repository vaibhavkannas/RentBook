import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "@/lib/sheets/service";
import { CARD, pillClasses } from "@/lib/ui-classes";

// The Activity page as it reads today, drawn with the shared pieces: a card for each entry and a pill for its action.

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  readActivity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ readWrittenAt: async () => undefined }));
vi.mock("@/lib/sheets/service", () => ({ readActivity: mocks.readActivity }));

import ActivityPage from "@/app/activity/page";

const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  savedAt: "2026-10-05T06:30:00.000Z",
  month: "2026-10",
  portion: "Ground floor",
  tenant: "Asha",
  amount: 10000,
  count: 4,
  dateReceived: "2026-10-05",
  loggedBy: "owner@example.com",
  action: "Logged",
  ...overrides,
});

async function render(): Promise<string> {
  const page = (await ActivityPage()) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.readActivity.mockResolvedValue([item()]);
});

describe("the Activity page", () => {
  it("sends a person who is not signed in to the sign-in page", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
  });

  it("has the title Activity as its one heading", async () => {
    const html = await render();
    expect(html).toContain('<h1 class="text-lg font-semibold">Activity</h1>');
  });

  it("draws each entry as a Card with the portion, the action as a Pill, and the amount", async () => {
    const html = await render();
    expect(html).toContain(`<li class="${CARD}">`);
    expect(html).toContain("Ground floor");
    expect(html).toContain(`<span class="${pillClasses("success")}">Logged</span>`);
    expect(html).toContain("Asha · Payment 4 · October 2026");
    expect(html).toContain("₹ 10,000");
    expect(html).toContain("owner@example.com");
  });

  it("colours the pill by the action: Logged green, Edited amber, Undone red", async () => {
    mocks.readActivity.mockResolvedValue([item({ action: "Edited" }), item({ action: "Undone", amount: null })]);
    const html = await render();
    expect(html).toContain(`<span class="${pillClasses("warn")}">Edited</span>`);
    expect(html).toContain(`<span class="${pillClasses("danger")}">Undone</span>`);
  });

  it("says nothing was recorded for an older row with no action, and still shows the row", async () => {
    mocks.readActivity.mockResolvedValue([item({ action: null })]);
    const html = await render();
    expect(html).toContain("No action recorded");
    expect(html).not.toContain(pillClasses("success"));
  });

  it("says nothing has been logged yet when there are no entries", async () => {
    mocks.readActivity.mockResolvedValue([]);
    expect(await render()).toContain("Nothing has been logged yet.");
  });
});
