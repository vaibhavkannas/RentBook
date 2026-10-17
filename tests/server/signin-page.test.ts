import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND } from "@/lib/brand";

// The sign-in page: the brand, one plain instruction, one button, and a plain reason when Google sent the person back
// with an error. The sign-in itself (the server action) is Auth.js's and is not run here.

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));

import SignInPage from "@/app/signin/page";

async function render(searchParams: { error?: string } = {}): Promise<string> {
  const page = (await SignInPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

/** The text a person reads, without the markup. */
const visibleText = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getViewer.mockResolvedValue(null);
});

describe("the sign-in page", () => {
  it("sends a person who is already signed in to the month screen", async () => {
    mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    await expect(render()).rejects.toThrow("redirect:/");
  });

  it("shows the brand mark, the name as the one heading, and the tagline", async () => {
    const html = await render();
    const mark = /<svg [^>]*>/.exec(html)?.[0] ?? "";
    expect(mark).toContain('width="56"');
    expect(mark).toContain('aria-hidden="true"');
    expect(mark).toMatch(/class="[^"]*\btext-accent\b/);
    expect(html).toContain(`<h1 class="mt-4 text-2xl font-semibold tracking-tight">${BRAND.name}</h1>`);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<p class="[^"]*\\btext-muted\\b[^"]*">${BRAND.tagline}</p>`));
  });

  it("says which account to use, has one Sign in with Google button, and says where the records stay", async () => {
    const text = visibleText(await render());
    expect(text).toContain("Sign in with the Google account the owner added.");
    expect(text).toContain("Your records stay in your own Google Sheet.");
    const html = await render();
    expect(html).toMatch(/<button type="submit" class="[^"]*\bmin-h-12\b[^"]*\bw-full\b[^"]*"[^>]*>Sign in with Google<\/button>/);
    expect(html.match(/<button/g)).toHaveLength(1);
    // it is a text button: Google's brand rules mean no logo is drawn here
    expect(html.match(/<svg/g)).toHaveLength(1);
  });

  it("is a centred page without room for a tab bar", async () => {
    const html = await render();
    expect(html).toMatch(/^<main class="[^"]*\bflex-col justify-center\b/);
    expect(html).not.toContain("pb-tabbar");
  });

  it("shows no error on a normal visit", async () => {
    const html = await render();
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("didn&#x27;t work");
  });

  describe("when Google sent the person back with an error", () => {
    const alert = (html: string) => /<p role="alert" class="([^"]*)">([^<]*)<\/p>/.exec(html);

    it("says the Google account is not on the list, and what to do about it", async () => {
      const found = alert(await render({ error: "AccessDenied" }));
      expect(found?.[2].replace(/&#x27;/g, "'")).toBe(
        `That Google account isn't on the list for ${BRAND.name}. Ask the owner to add it, or sign in with another account.`,
      );
      expect(found?.[1]).toContain("bg-danger-bg");
    });

    it("says sign-in is not set up correctly, and points the owner to SETUP.md", async () => {
      const found = alert(await render({ error: "Configuration" }));
      expect(found?.[2].replace(/&#x27;/g, "'")).toBe(
        "Sign-in isn't set up correctly. If you are the owner, check the sign-in settings in SETUP.md.",
      );
    });

    it("says sign-in did not work for any other error, without repeating the error", async () => {
      for (const error of ["Verification", "OAuthCallbackError", "x<script>"]) {
        const html = await render({ error });
        expect(alert(html)?.[2].replace(/&#x27;/g, "'"), error).toBe("Sign-in didn't work. Try again.");
        expect(html).not.toContain(error);
      }
    });

    it("keeps the button, under the message", async () => {
      const html = await render({ error: "AccessDenied" });
      expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf("Sign in with Google</button>"));
    });
  });
});
