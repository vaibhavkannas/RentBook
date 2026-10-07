import { describe, expect, it } from "vitest";
import { saveFailure, TENANCY_CONFLICT_MESSAGE, TENANCY_NO_CONFIRMATION } from "@/lib/tenancy-response";

describe("saveFailure", () => {
  it("says the page was updated, and asks for a refresh, on a conflict", () => {
    expect(TENANCY_CONFLICT_MESSAGE).toBe("This changed just now. The page was updated, please check and save again.");
    expect(
      saveFailure({ ok: false, error: { code: "conflict", message: "The tenancy of Asha was changed by someone else." } }),
    ).toEqual({ message: TENANCY_CONFLICT_MESSAGE, refresh: true });
  });

  it("shows the server's own message for any other failure, without a refresh", () => {
    expect(saveFailure({ ok: false, error: { code: "validation", message: "Move-in date is required." } })).toEqual({
      message: "Move-in date is required.",
      refresh: false,
    });
    expect(saveFailure({ ok: false, error: { code: "sheet-structure", message: "Fix the Tenants tab." } })).toEqual({
      message: "Fix the Tenants tab.",
      refresh: false,
    });
  });

  it("says it could not confirm the save when there was no answer", () => {
    expect(saveFailure(null)).toEqual({ message: TENANCY_NO_CONFIRMATION, refresh: false });
    expect(TENANCY_NO_CONFIRMATION).toMatch(/Couldn't confirm that the save went through/);
  });

  it("gives a general message when the answer has no error", () => {
    expect(saveFailure({ ok: false })).toEqual({ message: "Something went wrong. Try again.", refresh: false });
  });
});
