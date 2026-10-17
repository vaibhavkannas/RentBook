import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ExitGuard from "@/components/ExitGuard";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { withoutComments } from "../support/source-scan";

// The one toast region of the app, its place on the screen, and what happens to it when a sheet is open.

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const classesOf = (markup: string) => (/class="([^"]*)"/.exec(markup)?.[1] ?? "").split(" ");

describe("ToastProvider", () => {
  const out = html(createElement(ToastProvider, null, createElement("p", null, "the page")));

  it("shows the page it wraps, and then one live region", () => {
    expect(out).toMatch(/^<p>the page<\/p><div role="status" class="[^"]*"><\/div>$/);
  });

  it("has its live region on the page from the start and empty, so a screen reader announces the text that arrives in it", () => {
    expect(out.match(/role="status"/g)).toHaveLength(1);
    expect(out).not.toContain("<div role=\"status\" class=\"[^\"]*\"><p");
    expect(out.match(/<p/g)).toHaveLength(1);
  });

  it("puts it at the bottom of the screen, above the tab bar, over a sheet, and lets taps through", () => {
    const classes = classesOf(out.replace("<p>the page</p>", ""));
    expect(classes).toEqual(
      expect.arrayContaining(["pointer-events-none", "fixed", "inset-x-4", "z-50", "mx-auto", "max-w-md", "bottom-toast", "toast-region"]),
    );
  });
});

describe("useToast", () => {
  function Caller({ children }: { children?: ReactNode }) {
    const toast = useToast();
    // The server renders a page before anything is saved, and a test renders a form on its own: neither may fail.
    toast.show("a toast");
    return createElement("span", null, typeof toast.show, children);
  }

  it("does nothing outside the provider, so a server render or a test of a form works", () => {
    expect(html(createElement(Caller))).toBe("<span>function</span>");
  });

  it("gives a show function inside the provider", () => {
    expect(html(createElement(ToastProvider, null, createElement(Caller)))).toContain("<span>function</span>");
  });
});

describe("the exit toast and the shared toast", () => {
  const shared = classesOf(html(createElement(ToastProvider)));
  const exit = classesOf(html(createElement(ExitGuard)));

  it("both sit above the tab bar, the exit one a toast's height higher, so the two stack instead of covering each other", () => {
    expect(shared).toContain("bottom-toast");
    expect(shared).not.toContain("bottom-toast-high");
    expect(exit).toContain("bottom-toast-high");
    expect(exit).not.toContain("bottom-toast");
    expect(exit).not.toContain("bottom-20");
  });

  it("both are marked as toast regions, so they move out of the way of an open sheet", () => {
    expect(shared).toContain("toast-region");
    expect(exit).toContain("toast-region");
  });

  it("have the same look, and neither catches taps", () => {
    for (const classes of [shared, exit]) {
      expect(classes).toEqual(expect.arrayContaining(["pointer-events-none", "fixed", "inset-x-4", "z-50", "mx-auto", "max-w-md"]));
    }
  });
});

describe("globals.css for toasts", () => {
  const css = source("src/app/globals.css");

  it("puts a toast above the tab bar and the home indicator, with a little air", () => {
    expect(css).toMatch(
      /@utility bottom-toast\s*\{\s*bottom:\s*calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ 0\.75rem \+ var\(--toast-lift,\s*0rem\)\);\s*\}/,
    );
  });

  it("puts the exit toast 3.5rem higher than that", () => {
    expect(css).toMatch(/@utility bottom-toast-high\s*\{\s*--toast-lift:\s*3\.5rem;\s*bottom:\s*calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ 0\.75rem \+ var\(--toast-lift\)\);\s*\}/);
  });

  it("moves a toast to the top of the screen, inside the safe area, while a sheet is open, so it never covers the sheet's buttons", () => {
    expect(css).toMatch(
      /html\.sheet-open \.toast-region\s*\{\s*bottom:\s*auto;\s*top:\s*calc\(env\(safe-area-inset-top\) \+ 0\.75rem \+ var\(--toast-lift,\s*0rem\)\);\s*\}/,
    );
  });
});

describe("the root layout", () => {
  const layout = withoutComments(source("src/app/layout.tsx"));

  it("wraps the page in the toast provider, so a toast survives a refresh and a replace of the page below it", () => {
    expect(layout).toMatch(/import \{ ToastProvider \} from "@\/components\/ui\/Toast"/);
    expect(layout).toMatch(/<ToastProvider>\s*\{children\}\s*<\/ToastProvider>/);
  });

  it("keeps the tab bar after it", () => {
    expect(layout.indexOf("</ToastProvider>")).toBeLessThan(layout.indexOf("<TabBar />"));
  });
});

describe("the Toast source", () => {
  const code = withoutComments(source("src/components/ui/Toast.tsx"));

  it("leaves how long a toast lasts, and what a second one does, to createToastStore (tested in tests/domain)", () => {
    expect(code).toMatch(/import \{ createToastStore[^}]*\} from "@\/lib\/toast"/);
    expect(code).toMatch(/createToastStore\(/);
    expect(code).toMatch(/dispose\(\)/);
    expect(code).not.toMatch(/setTimeout/);
  });

  it("gives each toast its id as a key, so the same text twice shows again", () => {
    expect(code).toMatch(/key=\{toast\.id\}/);
  });
});
