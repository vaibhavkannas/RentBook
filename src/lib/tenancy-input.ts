import { MAX_RUPEES, type TenancyFields } from "@/lib/domain/tenancy";

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
