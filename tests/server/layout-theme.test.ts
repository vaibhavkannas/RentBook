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
