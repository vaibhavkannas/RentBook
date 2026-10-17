import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import { BRAND } from "@/lib/brand";
import { buttonClasses, pillClasses } from "@/lib/ui-classes";

// The More screen: who is signed in, the owner's way to the portion settings, Set up and Diagnostics, Sign out, and the version.

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth", () => ({ signOut: mocks.signOut }));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));

import MorePage from "@/app/more/page";

async function render(searchParams: Record<string, string | string[] | undefined> = {}): Promise<string> {
  const page = (await MorePage({ searchParams: Promise.resolve(searchParams) })) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

/** The text a person reads, without the markup. */
const visibleText = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const asOwner = () => mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
const asMember = () => mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });

beforeEach(() => {
  vi.clearAllMocks();
  asMember();
});

describe("the More page", () => {
  it("sends a person who is not signed in to the sign-in page", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
  });

  it("is titled More, with no arrow back, because it is a tab", async () => {
    const html = await render();
    expect(html).toContain('<h1 class="text-lg font-semibold">More</h1>');
    expect(html).not.toContain("aria-label=\"Back");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("says who is signed in, with an Owner pill for the owner", async () => {
    asOwner();
    const html = await render();
    expect(visibleText(html)).toContain("Signed in as owner@example.com");
    expect(html).toContain(`<span class="${pillClasses("success")}">Owner</span>`);
    expect(html).not.toContain(">Member<");
  });

  it("says who is signed in, with a Member pill for anyone else on the list", async () => {
    const html = await render();
    expect(visibleText(html)).toContain("Signed in as member@example.com");
    expect(html).toContain(`<span class="${pillClasses("neutral")}">Member</span>`);
    expect(html).not.toContain(">Owner<");
  });

  it("lets the owner open the portion settings, with what is in them, and carries the month", async () => {
    asOwner();
    const html = await render({ month: "2026-10" });
    const link = /<a [^>]*href="\/settings\?month=2026-10"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";
    expect(link).toContain("Portion settings");
    expect(link).toContain("Cycles, hikes, and adding or switching off portions");
    expect(link).not.toContain("Cycle length");
    expect(link).toMatch(/class="[^"]*\bmin-h-11\b/);
  });

  it("links to the portion settings without a month when there is none", async () => {
    asOwner();
    expect(await render()).toContain('href="/settings"');
    expect(await render({ month: "garbage" })).toContain('href="/settings"');
  });

  it("does not show a member the portion settings", async () => {
    const html = await render({ month: "2026-10" });
    expect(html).not.toContain("Portion settings");
    expect(html).not.toContain("/settings");
  });

  it.each([
    ["Set up", "/setup", "Check each part of the connection to your Sheet"],
    ["Diagnostics", "/diagnostics", "How the app and your Sheet are doing"],
  ])("lets the owner open %s, with what it is for, and carries the month", async (title, path, hint) => {
    asOwner();
    const html = await render({ month: "2026-10" });
    const link = new RegExp(`<a [^>]*href="${path}\\?month=2026-10"[^>]*>[\\s\\S]*?</a>`).exec(html)?.[0] ?? "";
    expect(link).toContain(`>${title}<`);
    expect(link).toContain(hint);
    expect(link).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(link).toMatch(/class="[^"]*\bpress\b/);
    expect(await render()).toContain(`href="${path}"`);
    expect(await render({ month: "garbage" })).toContain(`href="${path}"`);
  });

  it("puts the owner's rows in order: Portion settings, Set up, Diagnostics, then Sign out", async () => {
    asOwner();
    const html = await render();
    const at = (text: string) => html.indexOf(text);
    expect(at("Portion settings")).toBeGreaterThan(at("Signed in as"));
    expect(at("Set up")).toBeGreaterThan(at("Portion settings"));
    expect(at("Diagnostics")).toBeGreaterThan(at("Set up"));
    expect(at("Sign out")).toBeGreaterThan(at("Diagnostics"));
  });

  it("does not show a member Set up or Diagnostics, or a link to either", async () => {
    const html = await render({ month: "2026-10" });
    for (const text of ["Set up", "Diagnostics", "/setup", "/diagnostics", "Check each part", "How the app and your Sheet"]) {
      expect(html, text).not.toContain(text);
    }
  });

  it("has a Sign out button that says what it is doing while it works", async () => {
    const html = await render();
    expect(html).toMatch(/<button type="submit" class="[^"]*\bborder-control\b[^"]*"[^>]*>Sign out<\/button>/);
    expect(html).toContain(`class="${buttonClasses("secondary", "lg")} w-full">Sign out</button>`);
    expect(html).not.toContain("Signing out…");
  });

  it("ends with the brand mark, the name and the version", async () => {
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain(`${BRAND.name} · Version ${pkg.version}`);
    expect(html).toMatch(/<svg [^>]*aria-hidden="true"/);
    expect(html.indexOf(`Version ${pkg.version}`)).toBeGreaterThan(html.indexOf("Sign out"));
  });

  it("makes room for the tab bar", async () => {
    expect(await render()).toMatch(/^<main class="[^"]*\bpb-tabbar\b/);
  });
});
