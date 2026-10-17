import { describe, expect, it, vi } from "vitest";
import { plainProblem } from "@/lib/form-errors";
import { SOMETHING_WENT_WRONG_MESSAGE } from "@/lib/request-copy";
import {
  applyPageMove,
  changedPagePath,
  pageAfterConflict,
  pageAfterSave,
  saveFailure,
  showChangedNotice,
  tenantsPagePath,
  TENANCY_CONFLICT_MESSAGE,
  TENANCY_NO_CONFIRMATION,
} from "@/lib/tenancy-response";

describe("saveFailure", () => {
  const known = ["phone", "moveIn", "advance"];

  it("says the page was updated, and asks for a refresh, on a conflict", () => {
    expect(TENANCY_CONFLICT_MESSAGE).toBe("This changed just now. The page was updated. Please check and save again.");
    expect(
      saveFailure({ ok: false, error: { code: "conflict", message: "The tenancy of Asha was changed by someone else." } }, known),
    ).toEqual({ problem: plainProblem(TENANCY_CONFLICT_MESSAGE), refresh: true });
  });

  it("shows the server's own message for any other failure, in the form's own box, without a refresh", () => {
    expect(saveFailure({ ok: false, error: { code: "validation", message: "Something is wrong." } }, known)).toEqual({
      problem: plainProblem("Something is wrong."),
      refresh: false,
    });
    expect(saveFailure({ ok: false, error: { code: "sheet-structure", message: "Fix the Tenants tab." } }, known)).toEqual({
      problem: plainProblem("Fix the Tenants tab."),
      refresh: false,
    });
  });

  it("puts the message beside the field the server named, when the form has that field", () => {
    const failure = saveFailure(
      { ok: false, error: { code: "validation", message: "Phone can have at most 30 characters.", details: { field: "fields.phone" } } },
      known,
    );
    expect(failure).toEqual({
      problem: { message: "Phone can have at most 30 characters.", field: "phone", row: null },
      refresh: false,
    });
    // a field the form does not have goes in its own box
    expect(
      saveFailure({ ok: false, error: { code: "validation", message: "Notes are long.", details: { field: "fields.notes" } } }, known).problem,
    ).toEqual(plainProblem("Notes are long."));
  });

  it("tells a person who was signed out to sign in again", () => {
    expect(saveFailure({ ok: false, error: { code: "unauthorized", message: "Sign in with an allowed Google account." } }, known).problem.message).toBe(
      "You've been signed out. Reload the page to sign in again.",
    );
  });

  it("says it could not confirm the save when there was no answer", () => {
    expect(saveFailure(null, known)).toEqual({ problem: plainProblem(TENANCY_NO_CONFIRMATION), refresh: false });
    expect(TENANCY_NO_CONFIRMATION).toMatch(/Couldn't confirm that the save went through/);
  });

  it("says something went wrong on our side when the answer has no error", () => {
    expect(saveFailure({ ok: false }, known)).toEqual({ problem: plainProblem(SOMETHING_WENT_WRONG_MESSAGE), refresh: false });
  });
});

describe("the address of the tenant details page", () => {
  it("is the plain page for a normal visit, with the portion id encoded", () => {
    expect(tenantsPagePath("p1")).toBe("/tenants/p1");
    expect(tenantsPagePath("first floor/2")).toBe("/tenants/first%20floor%2F2");
  });

  it("asks the page to show the notice after a conflict", () => {
    expect(changedPagePath("p1")).toBe("/tenants/p1?changed=1");
    expect(changedPagePath("first floor/2")).toBe("/tenants/first%20floor%2F2?changed=1");
  });
});

describe("the address of the tenant details page, with the month it was opened from", () => {
  it("carries the month, so the arrow back leads to the month that was showing", () => {
    expect(tenantsPagePath("p1", "2026-10")).toBe("/tenants/p1?month=2026-10");
    expect(tenantsPagePath("first floor/2", "2026-09")).toBe("/tenants/first%20floor%2F2?month=2026-09");
    expect(changedPagePath("p1", "2026-10")).toBe("/tenants/p1?changed=1&month=2026-10");
  });

  it("is the same as before without a month, or with one that is not a month", () => {
    expect(tenantsPagePath("p1", null)).toBe("/tenants/p1");
    expect(tenantsPagePath("p1", undefined)).toBe("/tenants/p1");
    expect(tenantsPagePath("p1", "nope")).toBe("/tenants/p1");
    expect(changedPagePath("p1", null)).toBe("/tenants/p1?changed=1");
  });

  it("is kept by the move after a conflict", () => {
    expect(pageAfterConflict("p1", false, "2026-10")).toEqual({
      kind: "replace",
      url: "/tenants/p1?changed=1&month=2026-10",
      scroll: true,
    });
    expect(pageAfterConflict("p1", true, "2026-10")).toEqual({ kind: "refresh" });
  });

  it("is kept by the move after a save that has to take the notice away", () => {
    expect(pageAfterSave("p1", true, "2026-10")).toEqual({
      kind: "replace",
      url: "/tenants/p1?month=2026-10",
      scroll: false,
    });
    expect(pageAfterSave("p1", false, "2026-10")).toEqual({ kind: "refresh" });
  });
});

describe("showChangedNotice", () => {
  it("shows the notice only when the address says changed=1", () => {
    expect(showChangedNotice({ changed: "1" })).toBe(true);
    expect(showChangedNotice({ changed: ["0", "1"] })).toBe(true);
  });

  it("does not show it on a normal visit, or for any other value", () => {
    expect(showChangedNotice(undefined)).toBe(false);
    expect(showChangedNotice({})).toBe(false);
    expect(showChangedNotice({ changed: undefined })).toBe(false);
    expect(showChangedNotice({ changed: "" })).toBe(false);
    expect(showChangedNotice({ changed: "0" })).toBe(false);
    expect(showChangedNotice({ changed: "true" })).toBe(false);
    expect(showChangedNotice({ other: "1" })).toBe(false);
  });
});

describe("where the page goes after a save or a conflict", () => {
  it("opens the page with the notice after a conflict, scrolled to the top so the notice is seen", () => {
    expect(pageAfterConflict("p1", false)).toEqual({ kind: "replace", url: "/tenants/p1?changed=1", scroll: true });
  });

  it("only reloads after a conflict when the notice is already there", () => {
    expect(pageAfterConflict("p1", true)).toEqual({ kind: "refresh" });
  });

  it("only reloads after a save on a normal visit", () => {
    expect(pageAfterSave("p1", false)).toEqual({ kind: "refresh" });
  });

  it("goes back to the plain page after a save when the notice is showing, so it goes away, without jumping", () => {
    expect(pageAfterSave("p1", true)).toEqual({ kind: "replace", url: "/tenants/p1", scroll: false });
  });
});

describe("applyPageMove", () => {
  it("reloads the page for a refresh", () => {
    const router = { refresh: vi.fn(), replace: vi.fn() };
    applyPageMove(router, { kind: "refresh" });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("replaces the address, with the scroll choice, for a replace", () => {
    const router = { refresh: vi.fn(), replace: vi.fn() };
    applyPageMove(router, { kind: "replace", url: "/tenants/p1?changed=1", scroll: true });
    expect(router.replace).toHaveBeenCalledWith("/tenants/p1?changed=1", { scroll: true });
    expect(router.refresh).not.toHaveBeenCalled();
    applyPageMove(router, { kind: "replace", url: "/tenants/p1", scroll: false });
    expect(router.replace).toHaveBeenLastCalledWith("/tenants/p1", { scroll: false });
  });
});
