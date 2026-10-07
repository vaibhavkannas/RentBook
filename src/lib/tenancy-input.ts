import { MAX_RUPEES, type AdvanceStatus, type Tenancy, type TenancyFields } from "@/lib/domain/tenancy";

/**
 * What the forms send for tenancy details. The screens only gather text; the rules about what is
 * sent, and what is wrong, live here so they can be tested. The server checks everything again.
 */

export type RupeesResult = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * Whole rupees typed into a field. Blank is "nothing" (null). Commas, spaces and a rupee sign are
 * ignored, like the amount field of the payment sheet. Anything else that is not 0 to 10,000,000 is refused.
 */
export function parseRupees(text: string, label: string): RupeesResult {
  const cleaned = text.replace(/[,\s₹]/g, "");
  if (cleaned === "") return { ok: true, value: null };
  const value = /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
  if (!Number.isFinite(value) || value > MAX_RUPEES) {
    return { ok: false, message: `${label} must be a whole number of rupees from 0 to 10,000,000.` };
  }
  return { ok: true, value };
}

/**
 * Whether the person gave any tenancy detail beyond the default move-in date: an advance, an advance
 * date, an agreement end, a phone, notes, or a move-in date other than `defaultMoveIn`.
 * Spaces alone do not count. A move-in date that was cleared is a change, so it is not ignored.
 */
export function hasTenancyDetails(fields: TenancyFields, defaultMoveIn: string): boolean {
  const texts = [fields.phone, fields.agreementEnd, fields.advanceDate, fields.notes];
  return (
    texts.some((text) => (text ?? "").trim() !== "") ||
    Number.isFinite(fields.advance) ||
    fields.moveIn.trim() !== defaultMoveIn.trim()
  );
}

/** The "Tenancy details (optional)" part of the New tenant sheet, as typed. */
export type NewTenantDetailsForm = {
  moveIn: string;
  advance: string;
  advanceDate: string;
  agreementEnd: string;
  phone: string;
};

export type NewTenantDetails =
  | { ok: true; tenancy: TenancyFields | undefined }
  | { ok: false; message: string };

/**
 * The tenancy details the New tenant sheet sends with the payment, or `undefined` when the person left the
 * section as it was. When it sends details it always includes the move-in date (the default if untouched).
 */
export function newTenantDetails(form: NewTenantDetailsForm, defaultMoveIn: string): NewTenantDetails {
  const advance = parseRupees(form.advance, "Advance");
  if (!advance.ok) return advance;
  const fields: TenancyFields = {
    moveIn: form.moveIn.trim(),
    phone: form.phone.trim(),
    agreementEnd: form.agreementEnd.trim(),
    advance: advance.value,
    advanceDate: form.advanceDate.trim(),
  };
  if (!hasTenancyDetails(fields, defaultMoveIn)) return { ok: true, tenancy: undefined };
  if (fields.moveIn === "") {
    return { ok: false, message: "Tenancy details need a move-in date. Fill it in under Tenancy details." };
  }
  return { ok: true, tenancy: fields };
}

/** The tenancy form (create and edit), as typed. */
export type TenancyFormText = {
  phone: string;
  moveIn: string;
  agreementEnd: string;
  advance: string;
  advanceDate: string;
  notes: string;
};

/** A new form: everything empty except the move-in day. */
export function emptyTenancyForm(moveIn: string): TenancyFormText {
  return { phone: "", moveIn, agreementEnd: "", advance: "", advanceDate: "", notes: "" };
}

/** The edit form's starting values: what the Sheet holds now. */
export function tenancyFormText(
  t: Pick<Tenancy, "phone" | "moveIn" | "agreementEnd" | "advance" | "advanceDate" | "notes">,
): TenancyFormText {
  return {
    phone: t.phone,
    moveIn: t.moveIn,
    agreementEnd: t.agreementEnd,
    advance: t.advance === null ? "" : String(t.advance),
    advanceDate: t.advanceDate,
    notes: t.notes,
  };
}

/** Which tenancy a form is for. An edit carries the updated-at its page was rendered with. */
export type TenancyTarget =
  | { mode: "create"; portionId: string; tenant: string }
  | { mode: "edit"; portionId: string; tenant: string; id: string; expectedUpdatedAt: string };

/** The body of POST /api/tenancies. */
export type TenancyRequestBody = {
  portionId: string;
  tenant: string;
  fields: TenancyFields;
  id?: string;
  expectedUpdatedAt?: string;
};

export type TenancyRequest = { ok: true; body: TenancyRequestBody } | { ok: false; message: string };

/**
 * The body of POST /api/tenancies for a form. A create names the tenant the page showed; an edit names the tenancy
 * and the updated-at it was shown with (which may be empty for a row typed by hand), so a stale page is refused.
 */
export function buildTenancyRequest(target: TenancyTarget, form: TenancyFormText): TenancyRequest {
  const advance = parseRupees(form.advance, "Advance");
  if (!advance.ok) return advance;
  const moveIn = form.moveIn.trim();
  if (moveIn === "") return { ok: false, message: "Move-in date is required." };
  const fields: TenancyFields = {
    phone: form.phone.trim(),
    moveIn,
    agreementEnd: form.agreementEnd.trim(),
    advance: advance.value,
    advanceDate: form.advanceDate.trim(),
    notes: form.notes.trim(),
  };
  const common = { portionId: target.portionId, tenant: target.tenant, fields };
  return {
    ok: true,
    body:
      target.mode === "create"
        ? common
        : { ...common, id: target.id, expectedUpdatedAt: target.expectedUpdatedAt },
  };
}

/** The move-out form, as typed. An empty outcome means "leave it as it is". */
export type MoveOutFormText = {
  moveOut: string;
  advanceStatus: AdvanceStatus | "";
  refund: string;
  deductions: string;
  notes: string;
};

/** The move-out form's starting values: the day, the outcome the tenancy has now (Held if unknown) and its notes. */
export function emptyMoveOutForm(
  today: string,
  current: { advanceStatus: AdvanceStatus | null; notes: string },
): MoveOutFormText {
  return {
    moveOut: today,
    advanceStatus: current.advanceStatus ?? "Held",
    refund: "",
    deductions: "",
    notes: current.notes,
  };
}

/** The tenancy a move-out form closes, as the page was rendered. */
export type MoveOutTarget = {
  id: string;
  expectedUpdatedAt: string;
  hasAdvance: boolean;
  /** The notes the form started with: they are sent only when the person changed them. */
  initialNotes: string;
};

/** The body of POST /api/tenancies/move-out. */
export type MoveOutRequestBody = {
  id: string;
  expectedUpdatedAt: string;
  moveOut: string;
  advanceStatus?: AdvanceStatus;
  refund?: number;
  deductions?: number;
  notes?: string;
};

export type MoveOutRequest = { ok: true; body: MoveOutRequestBody } | { ok: false; message: string };

/**
 * The body of POST /api/tenancies/move-out for a form. What the person left empty or did not change is left out,
 * so the server keeps what is stored (a tenancy with no advance has no outcome; unchanged notes are not rewritten).
 */
export function buildMoveOutRequest(target: MoveOutTarget, form: MoveOutFormText): MoveOutRequest {
  const moveOut = form.moveOut.trim();
  if (moveOut === "") return { ok: false, message: "Move-out date is required." };
  const refund = parseRupees(form.refund, "Refund");
  if (!refund.ok) return refund;
  const deductions = parseRupees(form.deductions, "Deductions");
  if (!deductions.ok) return deductions;

  const body: MoveOutRequestBody = { id: target.id, expectedUpdatedAt: target.expectedUpdatedAt, moveOut };
  if (target.hasAdvance && form.advanceStatus !== "") body.advanceStatus = form.advanceStatus;
  if (refund.value !== null) body.refund = refund.value;
  if (deductions.value !== null) body.deductions = deductions.value;
  const notes = form.notes.trim();
  if (notes !== target.initialNotes.trim()) body.notes = notes;
  return { ok: true, body };
}

/**
 * A form's stale-screen token (`seen`) and its values (`form`), taken at the same moment, when the form was opened.
 * A form must save from its draft and never from live props: router.refresh() can deliver a newer token
 * while the typed values are still the old ones, and a save that mixed the two would overwrite someone's newer change
 * without a conflict. With a draft, anything that changed since the form opened is refused as a safe conflict.
 */
export type Draft<Seen, Form> = { readonly seen: Seen; readonly form: Form };

/** Starts a draft from the target and the values the page shows right now. Both are copied. */
export function startDraft<Seen extends object, Form extends object>(seen: Seen, initial: Form): Draft<Seen, Form> {
  return { seen: { ...seen }, form: { ...initial } };
}

/** The draft with some values changed. The token stays the one the draft started with. */
export function editDraft<Seen, Form>(draft: Draft<Seen, Form>, patch: Partial<Form>): Draft<Seen, Form> {
  return { seen: draft.seen, form: { ...draft.form, ...patch } };
}

export type TenancyDraft = Draft<TenancyTarget, TenancyFormText>;

/** The body of POST /api/tenancies for a draft: its own token and its own values. */
export function buildTenancyDraftRequest(draft: TenancyDraft): TenancyRequest {
  return buildTenancyRequest(draft.seen, draft.form);
}

export type MoveOutDraft = Draft<MoveOutTarget, MoveOutFormText>;

/** The body of POST /api/tenancies/move-out for a draft: its own token, notes baseline and values. */
export function buildMoveOutDraftRequest(draft: MoveOutDraft): MoveOutRequest {
  return buildMoveOutRequest(draft.seen, draft.form);
}
