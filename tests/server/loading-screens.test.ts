import { existsSync } from "node:fs";
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
import DiagnosticsLoading from "@/app/diagnostics/loading";
import SettingsLoading from "@/app/settings/loading";
import SetupLoading from "@/app/setup/loading";
import TenantsLoading from "@/app/tenants/[portionId]/loading";
import { CARD, CHIP_ROW } from "@/lib/ui-classes";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe.each([
  ["activity", ActivityLoading, "Loading activity"],
  ["settings", SettingsLoading, "Loading portion settings"],
  ["set up", SetupLoading, "Loading set up"],
  ["diagnostics", DiagnosticsLoading, "Loading diagnostics"],
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

  it("shows the two rows of filter chips the page has, in the page's own row classes: four for what happened, three for the portion", () => {
    expect(out.match(new RegExp(`class="${CHIP_ROW}"`, "g"))).toHaveLength(2);
    const [what, portion] = out.split(`class="${CHIP_ROW}"`).slice(1);
    // every chip is a 44 px bar, as a chip of the page is, and does not shrink in the scrolling row
    // (not min-h-11, which the header has)
    const chip = /(?<![-\w])h-11\b/g;
    expect(what.split("</div></div>")[0].match(chip)).toHaveLength(4);
    expect(portion.split("</div></div>")[0].match(chip)).toHaveLength(3);
    expect(out.match(chip)).toHaveLength(7);
    expect(out.match(/(?<![-\w])h-11\b[^"]*\bshrink-0\b/g)).toHaveLength(7);
    // a chip is not the 32 px bar the screen drew before it had chips
    expect(out).not.toMatch(/class="[^"]*\bh-8\b/);
  });

  it("shows a day heading the height of the sticky one (36 px) under the chips, then three entry cards", () => {
    expect(out.match(new RegExp(`class="${CARD}`, "g"))).toHaveLength(3);
    expect(out).toMatch(/<div class="py-2"><div aria-hidden="true" class="[^"]*\bh-5\b[^"]*"><\/div><\/div>/);
    const chipsAt = out.lastIndexOf(" h-11 ");
    const headingAt = out.indexOf('<div class="py-2">');
    const cardAt = out.indexOf(`class="${CARD}`);
    expect(chipsAt).toBeLessThan(headingAt);
    expect(headingAt).toBeLessThan(cardAt);
  });

  it("lays each card out like a real entry: the portion row, a two line sentence, the amount, the meta line", () => {
    const cards = out.split(`class="${CARD} space-y-1"`).slice(1);
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card).toMatch(/\bh-6\b/);
      expect(card.match(/\bh-4\b/g)).toHaveLength(2);
      expect(card).toMatch(/<div class="py-1">/);
      expect(card).toMatch(/\bh-5\b/);
    }
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

  it("lays each card out like the real one: the name, payments per cycle with its hint and the hike one under the other, and the tick box row", () => {
    const cards = out.split(`class="${CARD} space-y-2"`).slice(1);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      // one under the other: the labels and the hint are too long for half a phone's width
      expect(card).not.toContain("grid-cols-2");
      // each field has a 20 px label bar over its control, and payments per cycle a hint of two lines under it
      expect(card.match(/\bh-5\b/g)!.length).toBeGreaterThanOrEqual(3);
      expect(card.match(/\bh-10\b/g)).toHaveLength(1);
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

describe("the Set up loading screen", () => {
  const out = html(createElement(SetupLoading));

  it("has the header Set up, with an arrow back to More, as the page has", () => {
    expect(out).toContain('<h1 class="text-lg font-semibold">Set up</h1>');
    expect(out).toMatch(/<a [^>]*href="\/more"[^>]*>‹<\/a>/);
    expect(out).toContain('aria-label="Back to More"');
  });

  it("shows the intro, the headline and one card for each of the six steps, each with a title row and its checks", () => {
    expect(out.match(new RegExp(`class="${CARD}`, "g"))).toHaveLength(6);
    const cards = out.split(`class="${CARD}`).slice(1);
    for (const card of cards) {
      // a 24 px title bar and a status pill, then at least one check of two lines
      expect(card).toMatch(/\bh-6\b/);
      expect(card).toMatch(/\bh-5\b/);
      expect(card.match(/\bh-4\b/g)!.length).toBeGreaterThanOrEqual(2);
    }
    // the first card (sign-in) has the most checks, the last (portion settings) one
    expect(cards[0].match(/\bh-4\b/g)!.length).toBeGreaterThan(cards[5].match(/\bh-4\b/g)!.length);
  });

  it("has no button or link of its own besides the arrow back: nothing can be done on it", () => {
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).not.toContain("<button");
  });
});

describe("the Diagnostics loading screen", () => {
  const out = html(createElement(DiagnosticsLoading));

  it("has the header Diagnostics, with an arrow back to More, as the page has", () => {
    expect(out).toContain('<h1 class="text-lg font-semibold">Diagnostics</h1>');
    expect(out).toMatch(/<a [^>]*href="\/more"[^>]*>‹<\/a>/);
    expect(out).toContain('aria-label="Back to More"');
  });

  it("shows one card for each of the four sections: App, Google Sheet, Tabs and Problems", () => {
    expect(out.match(new RegExp(`class="${CARD}`, "g"))).toHaveLength(4);
    const cards = out.split(`class="${CARD}`).slice(1);
    for (const card of cards) {
      expect(card).toMatch(/\bh-6\b/);
      expect(card).toMatch(/\bh-4\b/);
    }
    // the Tabs card has four rows, the Google Sheet card one
    expect(cards[2].match(/\bh-4\b/g)!.length).toBeGreaterThan(cards[1].match(/\bh-4\b/g)!.length);
  });

  it("has no button or link of its own besides the arrow back", () => {
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).not.toContain("<button");
  });
});

describe("the pages that read the Sheet up to three times in a row", () => {
  it("each have a loading screen beside them, so a tap is answered at once", () => {
    for (const page of ["setup", "diagnostics"]) {
      expect(existsSync(new URL(`../../src/app/${page}/loading.tsx`, import.meta.url)), page).toBe(true);
    }
  });
});
