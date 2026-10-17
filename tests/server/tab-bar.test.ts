import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withoutComments } from "../support/source-scan";

// The bottom tab bar as the server renders it. Which way a tap goes (back, push, replace, nothing) is decided by
// navAction (tests/domain/app-nav.test.ts); what a tap does in a real browser was checked by hand.

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import BackRefresh from "@/components/BackRefresh";
import TabBar, { TabBarFallback } from "@/components/TabBar";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Each link of the bar: its href, its aria-current, its whole markup. */
function links(markup: string) {
  return [...markup.matchAll(/<a [^>]*>[\s\S]*?<\/a>/g)].map((match) => ({
    markup: match[0],
    href: /href="([^"]*)"/.exec(match[0])?.[1],
    current: /aria-current="([^"]*)"/.exec(match[0])?.[1],
    text: match[0].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim(),
  }));
}

function bar(path: string, search = "") {
  nav.pathname = path;
  nav.search = search;
  return html(createElement(TabBar));
}

beforeEach(() => {
  nav.pathname = "/";
  nav.search = "";
});

describe("TabBar", () => {
  it("is the main navigation, fixed to the bottom of the screen over the page and under a sheet", () => {
    const out = bar("/");
    expect(out).toMatch(/^<nav aria-label="Main" class="[^"]*"/);
    const classes = /class="([^"]*)"/.exec(out)![1].split(" ");
    expect(classes).toEqual(
      expect.arrayContaining(["fixed", "inset-x-0", "bottom-0", "z-30", "border-t", "border-line", "bg-surface", "h-tabbar"]),
    );
    // a sheet's backdrop is z-40 and the toast z-50
    expect(classes).not.toContain("z-40");
    expect(classes).not.toContain("z-50");
  });

  it("has three links, Month, Activity and More, in that order", () => {
    const found = links(bar("/"));
    expect(found.map((link) => link.text)).toEqual(["Month", "Activity", "More"]);
    expect(found.map((link) => link.href)).toEqual(["/", "/activity", "/more"]);
  });

  it("marks the tab of the screen as the current page, and no other", () => {
    const current = (path: string) => links(bar(path)).map((link) => link.current);
    expect(current("/")).toEqual(["page", undefined, undefined]);
    expect(current("/tenants/p1")).toEqual(["page", undefined, undefined]);
    expect(current("/activity")).toEqual([undefined, "page", undefined]);
    expect(current("/more")).toEqual([undefined, undefined, "page"]);
    expect(current("/settings")).toEqual([undefined, undefined, "page"]);
  });

  it("shows the current tab in the accent colour and the others muted", () => {
    const [month, activity] = links(bar("/"));
    expect(month.markup).toMatch(/class="[^"]*\btext-accent\b/);
    expect(month.markup).not.toMatch(/class="[^"]*\btext-muted\b/);
    expect(activity.markup).toMatch(/class="[^"]*\btext-muted\b/);
    expect(activity.markup).not.toMatch(/class="[^"]*\btext-accent\b/);
  });

  it("carries the month the person is looking at in every link", () => {
    expect(links(bar("/", "month=2026-10")).map((link) => link.href)).toEqual([
      "/?month=2026-10",
      "/activity?month=2026-10",
      "/more?month=2026-10",
    ]);
    expect(links(bar("/tenants/p1", "month=2026-09&changed=1")).map((link) => link.href)).toEqual([
      "/?month=2026-09",
      "/activity?month=2026-09",
      "/more?month=2026-09",
    ]);
  });

  it("carries no month when the address has none or has one that is not a month", () => {
    expect(links(bar("/activity", "month=garbage")).map((link) => link.href)).toEqual(["/", "/activity", "/more"]);
    expect(links(bar("/activity", "other=1")).map((link) => link.href)).toEqual(["/", "/activity", "/more"]);
  });

  it("makes each link at least 64 px tall, three equal columns, with an icon over a label", () => {
    for (const link of links(bar("/"))) {
      expect(link.markup).toMatch(/class="[^"]*\bmin-h-16\b[^"]*\bflex-1\b|class="[^"]*\bflex-1\b[^"]*\bmin-h-16\b/);
      expect(link.markup).toMatch(/class="[^"]*\bflex-col\b/);
      expect(link.markup).toMatch(/<svg [^>]*aria-hidden="true"/);
      expect(link.markup.match(/<svg/g)).toHaveLength(1);
    }
  });

  it("draws a link's focus ring inside the link, because the first and last links touch the edge of the screen", () => {
    for (const link of links(bar("/"))) {
      expect(link.markup).toMatch(/class="[^"]*\bfocus-visible:-outline-offset-2\b/);
    }
  });

  it("keeps the links inside the phone column, so on a wide screen they do not spread across it", () => {
    expect(bar("/")).toMatch(/<div class="[^"]*\bmax-w-md\b[^"]*\bmx-auto\b|<div class="[^"]*\bmx-auto\b[^"]*\bmax-w-md\b/);
  });

  it("has a pending dot in every link, hidden from screen readers and invisible until a tab is loading", () => {
    for (const link of links(bar("/"))) {
      const dot = /<span aria-hidden="true" class="([^"]*)"><\/span>/.exec(link.markup)?.[1] ?? "";
      expect(dot.split(" ")).toEqual(expect.arrayContaining(["size-1.5", "rounded-full", "bg-accent", "opacity-0", "transition-opacity"]));
      expect(dot).not.toContain("opacity-100");
    }
  });

  it("is not shown on the sign-in page, on a page that was not found, or anywhere that is not a tab", () => {
    for (const path of ["/signin", "/no-such-page", "/tenants", "/api/health"]) {
      expect(bar(path), path).toBe("");
    }
  });
});

describe("TabBarFallback", () => {
  it("is the same bar without the month, for the moment the address is not known yet", () => {
    nav.pathname = "/activity";
    nav.search = "month=2026-10";
    const fallback = html(createElement(TabBarFallback));
    expect(links(fallback).map((link) => link.href)).toEqual(["/", "/activity", "/more"]);
    expect(links(fallback).map((link) => link.current)).toEqual([undefined, "page", undefined]);
    expect(fallback).toMatch(/^<nav aria-label="Main"/);
  });

  it("is not shown where the bar is not", () => {
    nav.pathname = "/signin";
    expect(html(createElement(TabBarFallback))).toBe("");
  });
});

describe("the tab bar in the root layout", () => {
  const layout = withoutComments(source("src/app/layout.tsx"));

  it("is rendered once, after the page, inside a Suspense boundary whose fallback is the bar without the month", () => {
    expect(layout).toMatch(/import TabBar, \{ TabBarFallback \} from "@\/components\/TabBar"/);
    expect(layout).toMatch(/<Suspense fallback=\{<TabBarFallback \/>\}>\s*<TabBar \/>\s*<\/Suspense>/);
    expect(layout.indexOf("{children}")).toBeLessThan(layout.indexOf("<TabBar />"));
    expect(layout.match(/<TabBar \/>/g)).toHaveLength(1);
  });
});

describe("the TabBar source", () => {
  const code = withoutComments(source("src/components/TabBar.tsx"));
  const hook = withoutComments(source("src/components/useAppNavigate.ts"));

  it("reads the month from the address inside the Suspense-wrapped component only, and the path in both", () => {
    expect(code.match(/useSearchParams\(\)/g)).toHaveLength(1);
    expect(code).toMatch(/export function TabBarFallback\(\)\s*\{\s*return <TabBarView month=\{null\} \/>;/);
  });

  it("shows the pending dot for a Link navigation with useLinkStatus and for a replace with the hook's transition", () => {
    expect(code).toMatch(/useLinkStatus\(\)/);
    expect(code).toMatch(/replacingHref/);
    expect(hook).toMatch(/useTransition\(\)/);
    expect(hook).toMatch(/startTransition\(\(\) => router\.replace\(href\)\)/);
  });

  it("lets navAction decide what a tap does, and leaves a push to the Link", () => {
    expect(code).toMatch(/onNavigate=\{/);
    expect(hook).toMatch(/navAction\(/);
    expect(hook).toMatch(/previousEntryUrl\(/);
    expect(hook).toMatch(/router\.back\(\)/);
    expect(hook).toMatch(/event\.preventDefault\(\)/);
    expect(hook).toMatch(/scrollTo\(/);
  });

  it("says it is going back before it goes, so the screen it lands on is loaded again", () => {
    expect(hook).toMatch(/expectBack\(href\);\s*router\.back\(\);/);
  });

  it("touches the history only through the router, never through window.history itself", () => {
    expect(code).not.toContain("history.");
    expect(hook).not.toContain("history.");
  });
});

describe("globals.css for the tab bar", () => {
  const css = source("src/app/globals.css");

  it("has the bar's height as a token, 4rem", () => {
    expect(css).toMatch(/--tabbar-h:\s*4rem;/);
  });

  it("makes the bar that tall plus the home indicator, and keeps its links above the indicator", () => {
    expect(css).toMatch(
      /@utility h-tabbar\s*\{\s*height:\s*calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\)\);\s*padding-bottom:\s*env\(safe-area-inset-bottom\);\s*\}/,
    );
  });

  it("hides the bar on a touch screen while a text field, a select or a text area has focus, so the keyboard has the room", () => {
    const rule = /@media \(pointer: coarse\)\s*\{[\s\S]*?body:has\(([^{}]*)\)\s*nav\[aria-label="Main"\]\s*\{\s*visibility:\s*hidden;\s*transition:\s*none;\s*\}\s*\}/.exec(css);
    expect(rule, "a coarse-pointer rule that hides nav[aria-label=Main]").not.toBeNull();
    const condition = rule![1];
    expect(condition).toMatch(/\binput:not\([^)]*\):focus/);
    expect(condition).toMatch(/\bselect:focus/);
    expect(condition).toMatch(/\btextarea:focus/);
    // a tick box, a radio button and a button-like input open no keyboard
    for (const type of ["checkbox", "radio", "button", "submit"]) expect(condition).toContain(`[type="${type}"]`);
  });

  it("brings the bar back only after a moment, so it cannot appear under the finger that is tapping a button", () => {
    // Tapping Save blurs the field first, which would show the bar at once, over the button at the bottom of the
    // visible area, and the tap would land on the bar. visibility changes after a delay; display cannot be delayed.
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*nav\[aria-label="Main"\]\s*\{\s*transition:\s*visibility 0s linear 400ms;\s*\}/,
    );
    expect(css).not.toMatch(/nav\[aria-label="Main"\]\s*\{\s*display:\s*none/);
  });

  it("names the bar the way TabBar marks it, so the rule finds it", () => {
    nav.pathname = "/";
    expect(bar("/")).toContain('<nav aria-label="Main"');
  });

  it("makes a page's bottom padding clear the bar, the home indicator and 1.5rem more", () => {
    expect(css).toMatch(
      /@utility pb-tabbar\s*\{\s*padding-bottom:\s*calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ 1\.5rem\);\s*\}/,
    );
  });
});

describe("BackRefresh", () => {
  const layout = withoutComments(source("src/app/layout.tsx"));
  const code = withoutComments(source("src/components/BackRefresh.tsx"));

  it("is in the root layout, which a back does not unmount, and renders nothing", () => {
    expect(layout).toMatch(/import BackRefresh from "@\/components\/BackRefresh"/);
    expect(layout.match(/<BackRefresh \/>/g)).toHaveLength(1);
    expect(code).toMatch(/return null;/);
  });

  it("loads the screen again, through the router, when back-refresh says the screen a tap went back to is showing", () => {
    expect(code).toMatch(/if \(takeBackRefresh\(pathname, .*\)\) router\.refresh\(\);/);
    expect(code).toMatch(/useEffect\(\(\) => \{[\s\S]*\}, \[pathname, router\]\);/);
  });

  it("tells back-refresh whether the device is offline, so that it does not refresh into the browser's error page", () => {
    expect(code).toMatch(/takeBackRefresh\(pathname, Date\.now\(\), navigator\.onLine !== false\)/);
  });

  it("renders as nothing at all", () => {
    nav.pathname = "/";
    expect(html(createElement(BackRefresh))).toBe("");
  });
});
