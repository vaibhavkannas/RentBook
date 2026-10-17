import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELOAD_HINT, RELOAD_STEP, reloadThen } from "@/lib/recovery-hint";

// The one way the app tells a person to bring a screen that is out of date up to date. The installed app has no
// pull to refresh and no refresh button, but a tab switch loads the screen again, so that is what every message says.

describe("the recovery phrase", () => {
  it("is to switch to another tab and back", () => {
    expect(RELOAD_STEP).toBe("switch to another tab and back");
  });

  it("is a sentence that says what to do next", () => {
    expect(reloadThen("try again")).toBe("Switch to another tab and back, then try again.");
    expect(reloadThen("check before trying again")).toBe("Switch to another tab and back, then check before trying again.");
    expect(reloadThen("sign in again")).toBe("Switch to another tab and back, then sign in again.");
  });

  it("has a standard form, to try again", () => {
    expect(RELOAD_HINT).toBe("Switch to another tab and back, then try again.");
  });

  it("is free of anything that only the server may import, because the browser's code uses it too", () => {
    const source = readFileSync(new URL("../../src/lib/recovery-hint.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import /m);
  });
});
