import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The loading screens a navigation shows while the page reads the Sheet. Each says what is loading, is busy for a
// screen reader, and pulses only for people who have not asked for less motion.

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import ActivityLoading from "@/app/activity/loading";
import SettingsLoading from "@/app/settings/loading";
import TenantsLoading from "@/app/tenants/[portionId]/loading";
import { CARD } from "@/lib/ui-classes";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe.each([
  ["activity", ActivityLoading, "Loading activity"],
  ["settings", SettingsLoading, "Loading portion settings"],
  ["tenant details", TenantsLoading, "Loading tenant details"],
] as const)("the %s loading screen", (_name, Loading, loadingText) => {
  const out = html(createElement(Loading));

  it("is a busy page that says what is loading, in a line only a screen reader reads", () => {
    expect(out).toMatch(/^<main [^>]*aria-busy="true"/);
    expect(out).toContain(`<p class="sr-only">${loadingText}…</p>`);
  });

  it("makes room for the tab bar, like the page it stands in for", () => {
    expect(out).toMatch(/^<main [^>]*class="[^"]*\bpb-tabbar\b/);
  });

  it("hides its placeholders from screen readers and pulses them only for people who have not asked for less motion", () => {
    expect(out).toContain("animate-pulse");
    expect(out.match(/animate-pulse/g)!.length).toBe(out.match(/motion-reduce:animate-none/g)!.length);
    expect(out).not.toMatch(/<div class="[^"]*animate-pulse/);
  });
});

describe("the Activity loading screen", () => {
  const out = html(createElement(ActivityLoading));

  it("has the header Activity, with no arrow back, because Activity is a tab", () => {
    expect(out).toContain('<h1 class="text-lg font-semibold">Activity</h1>');
    expect(out).not.toContain("<a");
  });

  it("shows a row of three filter chips and three entry cards", () => {
    expect(out.match(new RegExp(`class="${CARD}`, "g"))).toHaveLength(3);
    // the chips are the 32 px bars in the row under the header
    expect(out.match(/class="[^"]*\bh-8\b/g)).toHaveLength(3);
  });
});

describe("the settings loading screen", () => {
  const out = html(createElement(SettingsLoading));

  it("has the header Portion settings, with an arrow back to More", () => {
    expect(out).toContain('<h1 class="text-lg font-semibold">Portion settings</h1>');
    expect(out).toMatch(/<a [^>]*href="\/more"[^>]*>‹<\/a>/);
    expect(out).toContain('aria-label="Back to More"');
  });

  it("shows two cards, one for each of the portions it stands in for", () => {
    expect(out.match(new RegExp(`class="${CARD}`, "g"))).toHaveLength(2);
  });

  it("lays each card out like the real one: a name field, the cycle and hike fields side by side, and the tick box row", () => {
    const cards = out.split(`class="${CARD} space-y-2"`).slice(1);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toContain("grid grid-cols-2 gap-3");
      // each field has a 20 px label bar over its control
      expect(card.match(/\bh-5\b/g)!.length).toBeGreaterThanOrEqual(3);
      // the "Count never resets" row is at least 44 px tall, with a 20 px box
      expect(card).toMatch(/min-h-11/);
      expect(card).toMatch(/\bsize-5\b/);
    }
    // three 48 px controls in each card (name, cycle length, hike), and the 48 px Save button after them
    expect(out.match(/\bh-12\b/g)).toHaveLength(2 * 3 + 1);
  });

  it("ends with a placeholder for the Save settings button, 48 px tall and as wide as the cards", () => {
    expect(out).toMatch(/<div aria-hidden="true" class="[^"]*\bh-12\b[^"]*\bw-full\b[^"]*"><\/div><\/div><\/main>$/);
  });
});

describe("the tenant details loading screen", () => {
  const out = html(createElement(TenantsLoading));

  it("has an arrow back to the month, and the same two cards as before", () => {
    expect(out).toMatch(/<a [^>]*href="\/"[^>]*>‹<\/a>/);
    expect(out).toContain('aria-label="Back to month"');
    expect(out.match(new RegExp(`class="${CARD}`, "g"))).toHaveLength(2);
  });
});
