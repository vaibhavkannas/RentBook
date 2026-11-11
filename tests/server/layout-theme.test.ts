import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The root layout puts the Appearance choice on <html> from the cookie, so the first paint is already right.

const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "rentbook-theme" && state.cookie !== undefined ? { name, value: state.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh() {}, back() {}, replace() {}, push() {} }),
}));
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "--font-inter" }),
  Space_Grotesk: () => ({ variable: "--font-space-grotesk" }),
}));

import RootLayout from "@/app/layout";
import { withoutComments } from "../support/source-scan";

async function htmlProps(cookie: string | undefined) {
  state.cookie = cookie;
  const tree = (await RootLayout({ children: createElement("main") } as never)) as ReactElement<Record<string, unknown>>;
  return tree.props;
}

beforeEach(() => {
  state.cookie = undefined;
});

describe("the root layout's theme", () => {
  it("leaves data-theme off when nothing was chosen (Auto)", async () => {
    expect((await htmlProps(undefined))["data-theme"]).toBeUndefined();
  });

  it.each(["light", "dark"])("sets data-theme=%s from the cookie", async (choice) => {
    expect((await htmlProps(choice))["data-theme"]).toBe(choice);
  });

  it("ignores a cookie that is not a choice", async () => {
    expect((await htmlProps("javascript:alert(1)"))["data-theme"]).toBeUndefined();
  });
});

describe("how the choice is applied and remembered", () => {
  const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  it("uses no inline script anywhere in the layout, which the nonce-based policy would block", () => {
    expect(withoutComments(source("src/app/layout.tsx"))).not.toMatch(/dangerouslySetInnerHTML|<script/);
  });

  it("draws ThemeSync in the layout, which applies a remembered choice only when the page has none", () => {
    expect(source("src/app/layout.tsx")).toMatch(/<ThemeSync \/>/);
    const sync = withoutComments(source("src/components/ThemeSync.tsx"));
    expect(sync).toMatch(/hasAttribute\("data-theme"\)/);
    expect(sync).toMatch(/adoptStoredTheme\(browserThemeEnv\(\)\)/);
  });

  it("makes each button of the Appearance control choose its theme, and reads what the page has on <html>", () => {
    const control = withoutComments(source("src/components/Appearance.tsx"));
    expect(control).toMatch(/onClick=\{\(\) => chooseTheme\(browserThemeEnv\(\), name\)\}/);
    expect(control).toMatch(/useSyncExternalStore\(subscribeTheme, currentTheme, \(\) => initial\)/);
  });
});
