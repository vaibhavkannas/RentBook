import { describe, expect, it } from "vitest";
import { prepareOutcome, type PrepareBody } from "@/lib/prepare-response";
import { SIGNED_OUT_MESSAGE, SOMETHING_WENT_WRONG_MESSAGE } from "@/lib/request-copy";

// What the Prepare my Sheet card does with what came back: a toast and a fresh page, or a message in its notice.

const answer = (body: PrepareBody) => body;

describe("prepareOutcome", () => {
  it("is a toast naming the tabs that were made, when the server says they were", () => {
    expect(prepareOutcome(answer({ ok: true, created: ["Settings", "Tenants"] }))).toEqual({
      ok: true,
      toast: "Your Sheet is ready: created Settings and Tenants.",
    });
  });

  it("is the toast for nothing created when the server made no tab, or sent no list", () => {
    expect(prepareOutcome(answer({ ok: true, created: [] }))).toEqual({ ok: true, toast: "Nothing needed creating." });
    expect(prepareOutcome(answer({ ok: true }))).toEqual({ ok: true, toast: "Nothing needed creating." });
  });

  it("shows the server's own words for an error, as the other forms do", () => {
    expect(prepareOutcome(answer({ ok: false, error: { code: "sheet-structure", message: "The Settings tab is missing." } }))).toEqual({
      ok: false,
      message: "The Settings tab is missing.",
    });
  });

  it("tells a signed-out owner to sign in, and says something went wrong for an error nobody expected", () => {
    expect(prepareOutcome(answer({ ok: false, error: { code: "unauthorized", message: "Sign in." } }))).toEqual({
      ok: false,
      message: SIGNED_OUT_MESSAGE,
    });
    expect(prepareOutcome(answer({ ok: false, error: { code: "internal", message: "boom" } }))).toEqual({
      ok: false,
      message: SOMETHING_WENT_WRONG_MESSAGE,
    });
    expect(prepareOutcome(answer({ ok: false }))).toEqual({ ok: false, message: SOMETHING_WENT_WRONG_MESSAGE });
  });
});
