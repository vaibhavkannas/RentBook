import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The pages a person sees when something breaks. They say it plainly, keep the colours of the rest of the app
// (the tokens of globals.css, as Tailwind classes), and are easy to hit with a thumb.

import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";

const MESSAGE = "Something went wrong on our side.";
const SAFE = "Your data is safe in your Sheet.";

/** Every element in a tree, found by calling nothing: these pages are plain functions of their props. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [node as ReactElement<Record<string, unknown>>, ...elements(props.children as ReactNode)];
}

/** The text a person reads, without the markup. */
const visibleText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("error.tsx, the page for an error inside the app", () => {
  const retry = vi.fn();
  const error = Object.assign(new Error("secret detail: Asha Verma 98765 43210"), { digest: "123" });
  const page = () => ErrorPage({ error, retry });
  const html = () => renderToStaticMarkup(page());

  it("says plainly that something went wrong on our side and that the data is safe", () => {
    const text = visibleText(html());
    expect(text).toContain(`${MESSAGE} ${SAFE}`);
  });

  it("never shows the error itself", () => {
    expect(html()).not.toContain("secret detail");
    expect(html()).not.toContain("Asha");
    expect(html()).not.toContain("123");
  });

  it("has a Try again button that asks Next to try again, and a link home", () => {
    // The button is the shared Button, so the tree holds a Button element, not a "button" tag: it is the one with a click handler.
    const button = elements(page()).find((element) => typeof element.props.onClick === "function");
    expect(button).toBeDefined();
    (button!.props.onClick as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(html()).toMatch(/<button type="button" [^>]*>Try again<\/button>/);
    expect(html()).toMatch(/<a [^>]*href="\/"[^>]*>[^<]*Back to RentBook/);
  });

  it("gives the button and the link a tap target of at least 44px", () => {
    expect(html()).toMatch(/<button [^>]*class="[^"]*\bmin-h-1[2-9]\b/);
    expect(html()).toMatch(/<a [^>]*class="[^"]*\bmin-h-1[1-9]\b/);
  });

  it("uses the colour tokens and no colour of its own", () => {
    expect(html()).toMatch(/class="[^"]*\bbg-accent\b[^"]*\btext-accent-ink\b/);
    expect(html()).toMatch(/\btext-muted\b/);
    expect(html()).not.toMatch(/#[0-9a-fA-F]{3,8}\b|style=|\b(?:bg|text)-(?:red|green|blue|gray|slate|white|black)\b/);
  });
});

describe("global-error.tsx, the page for an error in the page frame itself", () => {
  const html = () => renderToStaticMarkup(GlobalError());

  it("is a whole page of its own, because it replaces the root layout", () => {
    expect(html()).toMatch(/^<html lang="en"[^>]*><head>[\s\S]*<\/head><body[^>]*>[\s\S]*<\/body><\/html>$/);
  });

  it("says plainly that something went wrong on our side and that the data is safe", () => {
    expect(visibleText(html())).toContain(`${MESSAGE} ${SAFE}`);
  });

  it("works without any JavaScript: the way out is a plain link, not a button that needs a script to click", () => {
    // A page built ahead of time carries no nonce, and the Content-Security-Policy blocks its scripts: nothing here may need one.
    expect(html()).not.toContain("<button");
    expect(html()).not.toContain("<script");
    expect(html()).not.toContain("onclick");
    const page = GlobalError();
    const handlers = elements(page).filter((element) => Object.keys(element.props).some((key) => /^on[A-Z]/.test(key)));
    expect(handlers).toEqual([]);
    const links = elements(page).filter((element) => element.type === "a");
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe("/");
    expect(html()).toMatch(/<a [^>]*href="\/"[^>]*>Try again<\/a>/);
  });

  it("gives the link a tap target of at least 44px", () => {
    expect(html()).toMatch(/<a [^>]*class="[^"]*\bmin-h-1[1-9]\b/);
  });

  it("uses the colour tokens and no colour of its own", () => {
    expect(html()).toMatch(/class="[^"]*\bbg-accent\b[^"]*\btext-accent-ink\b/);
    expect(html()).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text)-(?:red|green|blue|gray|slate|white|black)\b/);
  });
});
