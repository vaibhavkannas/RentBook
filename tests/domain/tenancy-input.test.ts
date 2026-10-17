import { describe, expect, it } from "vitest";
import {
  buildMoveOutDraftRequest,
  buildMoveOutRequest,
  buildTenancyDraftRequest,
  buildTenancyRequest,
  editDraft,
  emptyMoveOutForm,
  emptyTenancyForm,
  hasTenancyDetails,
  newTenantDetails,
  parseRupees,
  startDraft,
  tenancyFormText,
  type MoveOutTarget,
  type TenancyFormText,
  type TenancyTarget,
} from "@/lib/tenancy-input";

describe("parseRupees", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["0", 0],
    ["20000", 20000],
    ["20,000", 20000],
    ["1,00,000", 100000],
    ["  ₹ 5,450 ", 5450],
    ["10000000", 10_000_000],
  ])("reads %j as %j", (text, value) => {
    expect(parseRupees(text, "Advance", "advance")).toEqual({ ok: true, value });
  });

  it.each(["1.5", "-5", "abc", "12a", "1e3", "5 000 x", "10000001", "99999999999999999999999"])(
    "refuses %j with a message that names the field, and says which field",
    (text) => {
      expect(parseRupees(text, "Refund", "refund")).toEqual({
        ok: false,
        message: "Refund must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.",
        field: "refund",
      });
    },
  );
});

describe("hasTenancyDetails", () => {
  const TODAY = "2026-10-05";

  it("is false for an untouched section", () => {
    expect(hasTenancyDetails({ moveIn: TODAY }, TODAY)).toBe(false);
    expect(
      hasTenancyDetails(
        { moveIn: TODAY, phone: "", agreementEnd: "", advance: null, advanceDate: "", notes: "" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("does not count spaces, or a move-in written with spaces around the default", () => {
    expect(hasTenancyDetails({ moveIn: ` ${TODAY} `, phone: "  ", notes: "\t" }, TODAY)).toBe(false);
  });

  it.each([
    ["an advance", { advance: 12000 }],
    ["an advance of zero", { advance: 0 }],
    ["an advance date", { advanceDate: "2026-09-28" }],
    ["an agreement end", { agreementEnd: "2027-09-30" }],
    ["a phone", { phone: "98000 12345" }],
    ["notes", { notes: "Cheque" }],
    ["a move-in that is not the default", { moveIn: "2026-10-01" }],
    ["a cleared move-in", { moveIn: "" }],
  ])("is true when there is %s", (_name, partial) => {
    expect(hasTenancyDetails({ moveIn: TODAY, ...partial }, TODAY)).toBe(true);
  });

  it("returns a plain boolean, and an advance that is not a finite number does not count", () => {
    expect(hasTenancyDetails({ moveIn: TODAY, advance: 5 }, TODAY)).toBe(true);
    expect(hasTenancyDetails({ moveIn: TODAY, advance: Number.NaN }, TODAY)).toBe(false);
    expect(hasTenancyDetails({ moveIn: TODAY, advance: Number.POSITIVE_INFINITY }, TODAY)).toBe(false);
    expect(hasTenancyDetails({ moveIn: TODAY, advance: undefined }, TODAY)).toBe(false);
  });
});

describe("newTenantDetails", () => {
  const TODAY = "2026-10-05";
  const untouched = { moveIn: TODAY, advance: "", advanceDate: "", agreementEnd: "", phone: "" };

  it("sends nothing for an untouched section", () => {
    expect(newTenantDetails(untouched, TODAY)).toEqual({ ok: true, tenancy: undefined });
  });

  it("sends nothing when the only text is spaces", () => {
    expect(newTenantDetails({ ...untouched, advance: "  ", phone: " " }, TODAY)).toEqual({
      ok: true,
      tenancy: undefined,
    });
  });

  it.each([
    ["an advance", { advance: "12,000" }],
    ["an advance date", { advanceDate: "2026-09-28" }],
    ["an agreement end", { agreementEnd: "2027-09-30" }],
    ["a phone", { phone: "98000 12345" }],
  ])("sends the details, with the default move-in, when only %s is filled", (_name, partial) => {
    const result = newTenantDetails({ ...untouched, ...partial }, TODAY);
    expect(result.ok && result.tenancy).toMatchObject({ moveIn: TODAY });
    expect(result.ok && result.tenancy).toBeDefined();
  });

  it("sends every field the person filled in, cleaned", () => {
    const result = newTenantDetails(
      {
        moveIn: " 2026-10-01 ",
        advance: "₹ 12,000",
        advanceDate: "2026-09-28",
        agreementEnd: "2027-09-30",
        phone: " 98000 12345 ",
      },
      TODAY,
    );
    expect(result).toEqual({
      ok: true,
      tenancy: {
        moveIn: "2026-10-01",
        advance: 12000,
        advanceDate: "2026-09-28",
        agreementEnd: "2027-09-30",
        phone: "98000 12345",
      },
    });
  });

  it("sends the details when only the move-in date was changed", () => {
    expect(newTenantDetails({ ...untouched, moveIn: "2026-10-01" }, TODAY)).toEqual({
      ok: true,
      tenancy: { moveIn: "2026-10-01", advance: null, advanceDate: "", agreementEnd: "", phone: "" },
    });
  });

  it("keeps an advance of zero", () => {
    const result = newTenantDetails({ ...untouched, advance: "0" }, TODAY);
    expect(result.ok && result.tenancy?.advance).toBe(0);
  });

  it("refuses an advance that is not a whole number of rupees, even when nothing else is filled", () => {
    for (const advance of ["abc", "1.5", "-1", "10000001"]) {
      const result = newTenantDetails({ ...untouched, advance }, TODAY);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toMatch(/^Advance must be whole rupees/);
      expect(result.ok ? "" : result.field).toBe("advance");
    }
  });

  it("refuses details that have no move-in date", () => {
    for (const form of [{ ...untouched, moveIn: "" }, { ...untouched, moveIn: "  ", phone: "98000 12345" }]) {
      const result = newTenantDetails(form, TODAY);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toMatch(/move-in date/i);
      expect(result.ok ? "" : result.field).toBe("moveIn");
    }
  });
});

describe("emptyTenancyForm and tenancyFormText", () => {
  it("starts an empty form on the given move-in day", () => {
    expect(emptyTenancyForm("2026-10-05")).toEqual({
      phone: "",
      moveIn: "2026-10-05",
      agreementEnd: "",
      advance: "",
      advanceDate: "",
      notes: "",
    });
  });

  it("fills the form from a tenancy, with the advance as text", () => {
    expect(
      tenancyFormText({
        phone: "98765 43210",
        moveIn: "2026-01-15",
        agreementEnd: "2027-01-14",
        advance: 20000,
        advanceDate: "2026-01-10",
        notes: "Paid by cheque",
      }),
    ).toEqual({
      phone: "98765 43210",
      moveIn: "2026-01-15",
      agreementEnd: "2027-01-14",
      advance: "20000",
      advanceDate: "2026-01-10",
      notes: "Paid by cheque",
    });
  });

  it("shows no advance as an empty field and an advance of zero as 0", () => {
    const base = { phone: "", moveIn: "2026-01-15", agreementEnd: "", advanceDate: "", notes: "" };
    expect(tenancyFormText({ ...base, advance: null }).advance).toBe("");
    expect(tenancyFormText({ ...base, advance: 0 }).advance).toBe("0");
  });
});

describe("buildTenancyRequest", () => {
  const form = {
    phone: " 98765 43210 ",
    moveIn: "2026-01-15",
    agreementEnd: "2027-01-14",
    advance: "20,000",
    advanceDate: "2026-01-10",
    notes: "  Paid by cheque ",
  };
  const fields = {
    phone: "98765 43210",
    moveIn: "2026-01-15",
    agreementEnd: "2027-01-14",
    advance: 20000,
    advanceDate: "2026-01-10",
    notes: "Paid by cheque",
  };

  it("builds a create request with the tenant name the page showed", () => {
    expect(buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, form)).toEqual({
      ok: true,
      body: { portionId: "p1", tenant: "Asha", fields },
    });
  });

  it("builds an edit request with the id and the updated-at the page was rendered with", () => {
    expect(
      buildTenancyRequest(
        { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "2026-01-15T05:00:00.000Z" },
        form,
      ),
    ).toEqual({
      ok: true,
      body: {
        portionId: "p1",
        tenant: "Asha",
        id: "t-1",
        expectedUpdatedAt: "2026-01-15T05:00:00.000Z",
        fields,
      },
    });
  });

  it("sends an empty updated-at as it is: a hand-typed row can have none", () => {
    const result = buildTenancyRequest(
      { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "" },
      form,
    );
    expect(result.ok && "expectedUpdatedAt" in result.body && result.body.expectedUpdatedAt).toBe("");
  });

  it("sends no advance as null", () => {
    const result = buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, { ...form, advance: " " });
    expect(result.ok && result.body.fields.advance).toBeNull();
  });

  it("refuses an advance that is not a whole number of rupees", () => {
    const result = buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, { ...form, advance: "2.5k" });
    expect(result).toEqual({
      ok: false,
      message: "Advance must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.",
      field: "advance",
    });
  });

  it("refuses a form with no move-in date", () => {
    const result = buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, { ...form, moveIn: " " });
    expect(result).toEqual({ ok: false, message: "Move-in date is required.", field: "moveIn" });
  });

  it("looks at the move-in date before the advance, the order the fields are in on the screen", () => {
    const result = buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, { ...form, moveIn: "", advance: "lots" });
    expect(result).toMatchObject({ ok: false, field: "moveIn" });
  });
});

describe("emptyMoveOutForm", () => {
  it("starts on the given day, with the outcome the tenancy has and its notes", () => {
    expect(emptyMoveOutForm("2026-10-05", { advanceStatus: "Adjusted", notes: "Cheque" })).toEqual({
      moveOut: "2026-10-05",
      advanceStatus: "Adjusted",
      refund: "",
      deductions: "",
      notes: "Cheque",
    });
  });
  it("starts the outcome as Held when none is known", () => {
    expect(emptyMoveOutForm("2026-10-05", { advanceStatus: null, notes: "" }).advanceStatus).toBe("Held");
  });
});

describe("buildMoveOutRequest", () => {
  const target = { id: "t-1", expectedUpdatedAt: "2026-01-15T05:00:00.000Z", hasAdvance: true, initialNotes: "Cheque" };
  const form = { moveOut: "2026-09-30", advanceStatus: "Refunded" as const, refund: "15,000", deductions: "5000", notes: "Cheque" };

  it("sends the id, the updated-at the page had, the date, the outcome, the refund and the deductions", () => {
    expect(buildMoveOutRequest(target, form)).toEqual({
      ok: true,
      body: {
        id: "t-1",
        expectedUpdatedAt: "2026-01-15T05:00:00.000Z",
        moveOut: "2026-09-30",
        advanceStatus: "Refunded",
        refund: 15000,
        deductions: 5000,
      },
    });
  });

  it("sends the notes only when the person changed them", () => {
    const unchanged = buildMoveOutRequest(target, { ...form, notes: " Cheque " });
    expect(unchanged.ok && "notes" in unchanged.body).toBe(false);
    const changed = buildMoveOutRequest(target, { ...form, notes: " Left the keys " });
    expect(changed.ok && changed.body.notes).toBe("Left the keys");
    const cleared = buildMoveOutRequest(target, { ...form, notes: "" });
    expect(cleared.ok && cleared.body.notes).toBe("");
  });

  it("leaves out an empty refund and empty deductions", () => {
    const result = buildMoveOutRequest(target, { ...form, refund: "", deductions: " " });
    expect(result.ok && "refund" in result.body).toBe(false);
    expect(result.ok && "deductions" in result.body).toBe(false);
  });

  it("keeps a refund or deductions of zero", () => {
    const result = buildMoveOutRequest(target, { ...form, refund: "0", deductions: "0" });
    expect(result.ok && result.body.refund).toBe(0);
    expect(result.ok && result.body.deductions).toBe(0);
  });

  it("sends no outcome for a tenancy without an advance", () => {
    const result = buildMoveOutRequest({ ...target, hasAdvance: false }, form);
    expect(result.ok && "advanceStatus" in result.body).toBe(false);
  });

  it("sends an empty updated-at as it is", () => {
    const result = buildMoveOutRequest({ ...target, expectedUpdatedAt: "" }, form);
    expect(result.ok && result.body.expectedUpdatedAt).toBe("");
  });

  it("refuses a missing move-out date", () => {
    expect(buildMoveOutRequest(target, { ...form, moveOut: "" })).toEqual({
      ok: false,
      message: "Move-out date is required.",
      field: "moveOut",
    });
  });

  it("names the field when the refund or the deductions are wrong", () => {
    expect(buildMoveOutRequest(target, { ...form, refund: "ten" })).toEqual({
      ok: false,
      message: "Refund must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.",
      field: "refund",
    });
    expect(buildMoveOutRequest(target, { ...form, deductions: "-5" })).toEqual({
      ok: false,
      message: "Deductions must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.",
      field: "deductions",
    });
  });
});

// A form saves with the stale-screen token and the values it was OPENED with, never with a token from props
// that a later router.refresh() delivered. These cases act out the ways a live token used to overwrite newer data.
describe("tenancy drafts", () => {
  const OLD_AT = "2026-01-15T05:00:00.000Z";
  const NEW_AT = "2026-10-06T09:00:00.000Z";
  const editTarget = (expectedUpdatedAt: string): TenancyTarget => ({
    mode: "edit",
    portionId: "p1",
    tenant: "Asha",
    id: "t-1",
    expectedUpdatedAt,
  });
  const oldValues: TenancyFormText = { ...emptyTenancyForm("2026-01-15"), phone: "11111", notes: "old notes" };
  const newValues: TenancyFormText = { ...emptyTenancyForm("2026-01-15"), phone: "99999", notes: "newer notes" };

  it("builds the request from the token and the values it started with", () => {
    const draft = startDraft(editTarget(OLD_AT), oldValues);
    const request = buildTenancyDraftRequest(draft);
    expect(request).toMatchObject({
      ok: true,
      body: { id: "t-1", expectedUpdatedAt: OLD_AT, fields: { phone: "11111", notes: "old notes" } },
    });
  });

  it("applies what the person types and keeps the token", () => {
    const draft = editDraft(startDraft(editTarget(OLD_AT), oldValues), { phone: "22222" });
    expect(buildTenancyDraftRequest(draft)).toMatchObject({
      ok: true,
      body: { expectedUpdatedAt: OLD_AT, fields: { phone: "22222", notes: "old notes" } },
    });
  });

  it("does not change the draft it edits, or the objects it started from", () => {
    const target = editTarget(OLD_AT);
    const draft = startDraft(target, oldValues);
    const typed = editDraft(draft, { phone: "22222" });
    expect(draft.form.phone).toBe("11111");
    expect(typed.seen).toEqual(target);
    expect(oldValues.phone).toBe("11111");
  });

  it("(a) reopening before the refresh lands keeps the OLD token with the OLD values, so a late save is refused as stale", () => {
    // the first edit saved (the Sheet now holds NEW_AT) but the page props are still the old ones when Edit is tapped
    const reopened = startDraft(editTarget(OLD_AT), oldValues);
    // the refresh lands: the page props now carry the new token and values. The open draft does not follow them.
    const propsAfterRefresh = { target: editTarget(NEW_AT), initial: newValues };
    expect(propsAfterRefresh.target).toMatchObject({ expectedUpdatedAt: NEW_AT });
    const request = buildTenancyDraftRequest(reopened);
    expect(request.ok && request.body.expectedUpdatedAt).toBe(OLD_AT);
    expect(request.ok && request.body.fields.phone).toBe("11111");
  });

  it("(b) after a conflict the next draft starts from the fresh page: new token AND new values together", () => {
    const stale = startDraft(editTarget(OLD_AT), oldValues);
    const reopened = startDraft(editTarget(NEW_AT), newValues);
    expect(buildTenancyDraftRequest(reopened)).toMatchObject({
      ok: true,
      body: { expectedUpdatedAt: NEW_AT, fields: { phone: "99999", notes: "newer notes" } },
    });
    // and the stale draft still cannot pass the newer token with its old values
    expect(buildTenancyDraftRequest(stale)).toMatchObject({ body: { expectedUpdatedAt: OLD_AT } });
  });

  it("(d) a create draft keeps the tenant it started with, even when the Schedule's tenant has changed since", () => {
    const asha = startDraft<TenancyTarget, TenancyFormText>(
      { mode: "create", portionId: "p1", tenant: "Asha" },
      { ...emptyTenancyForm("2026-10-05"), phone: "11111", advance: "5000" },
    );
    // the Schedule now names Hari: the page gives the form a new key, so a NEW draft starts empty
    const hari = startDraft<TenancyTarget, TenancyFormText>(
      { mode: "create", portionId: "p1", tenant: "Hari" },
      emptyTenancyForm("2026-10-05"),
    );
    expect(buildTenancyDraftRequest(asha)).toMatchObject({
      body: { tenant: "Asha", fields: { phone: "11111", advance: 5000 } },
    });
    expect(buildTenancyDraftRequest(hari)).toMatchObject({
      body: { tenant: "Hari", fields: { phone: "", advance: null } },
    });
  });

  it("refuses a draft whose typed values are wrong, with the same messages as before", () => {
    const draft = editDraft(startDraft(editTarget(OLD_AT), oldValues), { advance: "lots" });
    expect(buildTenancyDraftRequest(draft)).toEqual({
      ok: false,
      message: "Advance must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.",
      field: "advance",
    });
  });
});

describe("move-out drafts", () => {
  const OLD_AT = "2026-01-15T05:00:00.000Z";
  const NEW_AT = "2026-10-06T09:00:00.000Z";
  const moveOutTarget = (expectedUpdatedAt: string, initialNotes: string): MoveOutTarget => ({
    id: "t-1",
    expectedUpdatedAt,
    hasAdvance: true,
    initialNotes,
  });

  it("builds the request from the token and the notes it started with", () => {
    const draft = startDraft(
      moveOutTarget(OLD_AT, "old notes"),
      emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "old notes" }),
    );
    const request = buildMoveOutDraftRequest(draft);
    expect(request).toMatchObject({ ok: true, body: { id: "t-1", expectedUpdatedAt: OLD_AT, moveOut: "2026-10-05" } });
    // the notes were not changed, so they are not sent
    expect(request.ok && "notes" in request.body).toBe(false);
  });

  it("(c) unchanged notes stay unsent even when the page's notes changed after the form opened", () => {
    // opened with "old notes"; the page later shows "newer notes" (another person's edit) as its new target
    const draft = startDraft(
      moveOutTarget(OLD_AT, "old notes"),
      emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "old notes" }),
    );
    const laterProps = moveOutTarget(NEW_AT, "newer notes");
    expect(laterProps.initialNotes).toBe("newer notes");
    const request = buildMoveOutDraftRequest(draft);
    expect(request.ok && "notes" in request.body).toBe(false);
    expect(request.ok && request.body.expectedUpdatedAt).toBe(OLD_AT);
  });

  it("(c) a draft started from the fresh page after a conflict has the newer notes on both sides, and sends none", () => {
    const draft = startDraft(
      moveOutTarget(NEW_AT, "newer notes"),
      emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "newer notes" }),
    );
    const request = buildMoveOutDraftRequest(draft);
    expect(request.ok && request.body.expectedUpdatedAt).toBe(NEW_AT);
    expect(request.ok && "notes" in request.body).toBe(false);
  });

  it("sends notes the person changed, with the token the draft started with", () => {
    const draft = editDraft(
      startDraft(
        moveOutTarget(OLD_AT, "old notes"),
        emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "old notes" }),
      ),
      { notes: "Left the keys", refund: "5,000" },
    );
    expect(buildMoveOutDraftRequest(draft)).toEqual({
      ok: true,
      body: {
        id: "t-1",
        expectedUpdatedAt: OLD_AT,
        moveOut: "2026-10-05",
        advanceStatus: "Held",
        refund: 5000,
        notes: "Left the keys",
      },
    });
  });

  it("does not change the draft it edits", () => {
    const draft = startDraft(
      moveOutTarget(OLD_AT, ""),
      emptyMoveOutForm("2026-10-05", { advanceStatus: null, notes: "" }),
    );
    editDraft(draft, { refund: "9" });
    expect(draft.form.refund).toBe("");
  });
});
