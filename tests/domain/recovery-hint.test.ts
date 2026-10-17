import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELOAD_HINT, RELOAD_STEP, reloadThen, SIGN_IN_HINT } from "@/lib/recovery-hint";

// The one way the app tells a person to bring a screen that is out of date up to date. The installed app has no
// pull to refresh and no refresh button, but tapping another tab of the bar at the bottom of the screen and coming back
// loads the screen again, so that is what every message says. It says "tab at the bottom of the screen" because a Sheet
// also has tabs, and a browser has its own.

describe("the recovery phrase", () => {
  it("is to tap another tab at the bottom of the screen and come back", () => {
    expect(RELOAD_STEP).toBe("tap another tab at the bottom of the screen and come back");
  });

  it("names the bar at the bottom of the screen, so it is not taken for a browser tab or a tab of the Sheet", () => {
    expect(RELOAD_STEP).toContain("at the bottom of the screen");
    expect(RELOAD_STEP).not.toMatch(/\bswitch\b/i);
  });

  it("is a sentence that says what to do next", () => {
    expect(reloadThen("try again")).toBe("Tap another tab at the bottom of the screen and come back, then try again.");
    expect(reloadThen("check before trying again")).toBe(
      "Tap another tab at the bottom of the screen and come back, then check before trying again.",
    );
    expect(reloadThen("check the card")).toBe("Tap another tab at the bottom of the screen and come back, then check the card.");
  });

  it("has a standard form, to try again", () => {
    expect(RELOAD_HINT).toBe("Tap another tab at the bottom of the screen and come back, then try again.");
  });

  it("has a form for a person who has been signed out, which says nothing of coming back: the next screen is the sign-in page", () => {
    expect(SIGN_IN_HINT).toBe("Tap another tab at the bottom of the screen to sign in again.");
    expect(SIGN_IN_HINT).not.toMatch(/come back|then/);
  });

  it("is free of anything that only the server may import, because the browser's code uses it too", () => {
    const source = readFileSync(new URL("../../src/lib/recovery-hint.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import /m);
  });
});
