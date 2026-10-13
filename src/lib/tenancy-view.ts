import { sameTenantName, type Tenancy } from "@/lib/domain/tenancy";
import { formatDay, formatRupees, formatSavedAt } from "@/lib/format";

/** The words the tenant details page shows about a tenancy, kept here so they can be tested. */

/** "₹ 20,000 · Held · paid 10 Jan 2026", or null when there is no advance. */
export function advanceSummary(t: Pick<Tenancy, "advance" | "advanceStatus" | "advanceDate">): string | null {
  if (t.advance === null) return null;
  const parts = [formatRupees(t.advance)];
  if (t.advanceStatus) parts.push(t.advanceStatus);
  const paid = t.advanceDate.trim();
  if (paid !== "") parts.push(`paid ${formatDay(paid)}`);
  return parts.join(" · ");
}

/** "15 Jan 2026 to 30 Sep 2026", or "From 15 Jan 2026" while the tenancy is current. A missing day is a dash. */
export function tenancyPeriod(moveIn: string, moveOut: string): string {
  const from = moveIn.trim() === "" ? "—" : formatDay(moveIn.trim());
  const to = moveOut.trim();
  return to === "" ? `From ${from}` : `${from} to ${formatDay(to)}`;
}

/** What happened to the money of a past tenancy: "Advance ₹ 20,000 · Adjusted · Refund ₹ 15,000 · Deductions ₹ 5,000". */
export function advanceOutcome(
  t: Pick<Tenancy, "advance" | "advanceStatus" | "refund" | "deductions">,
): string | null {
  const parts: string[] = [];
  if (t.advance !== null) {
    parts.push(`Advance ${formatRupees(t.advance)}`);
    if (t.advanceStatus) parts.push(t.advanceStatus);
  }
  if (t.refund !== null) parts.push(`Refund ${formatRupees(t.refund)}`);
  if (t.deductions !== null) parts.push(`Deductions ${formatRupees(t.deductions)}`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * A tel: link for a phone number, or null when it has no digits. Only digits and a leading plus are kept,
 * so text typed by hand into the Sheet cannot change what the link does.
 */
export function phoneHref(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** "owner@example.com · 5 Oct, 10:00 am" (India time). */
export function lastUpdatedText(t: Pick<Tenancy, "updatedBy" | "updatedAt">): string {
  const by = t.updatedBy.trim();
  const at = t.updatedAt.trim();
  if (by === "" && at === "") return "Not recorded";
  if (at === "") return by;
  return by === "" ? formatSavedAt(at) : `${by} · ${formatSavedAt(at)}`;
}

/** Under "What happened to the advance?" in the move-out form. */
export const MOVE_OUT_OUTCOME_HINT =
  "Refunded: given back to the tenant. Adjusted: used against rent or damage. Held: still kept.";

/** Under the Refund and Deductions fields of the move-out form. */
export const MOVE_OUT_RUPEES_HINT = "Whole rupees, leave blank if none.";

/** The line under the "Add details" heading: whose details these are, and where a different tenant is added. */
export function addDetailsHint(scheduleTenant: string): string {
  return `Adding details for ${scheduleTenant}. A new tenant is added with New tenant on the month screen.`;
}

/**
 * A short note for the "Add details" form of a portion that has no current tenancy: either earlier details for
 * another tenant name will be closed by saving, or the same tenant already moved out. Null when there is nothing to say.
 */
export function noCurrentTenancyNote(input: {
  scheduleTenant: string | null;
  mismatched: Pick<Tenancy, "tenant"> | null;
  /** The most recent past tenancy of the portion. */
  lastPast: Pick<Tenancy, "tenant" | "moveOut"> | undefined;
}): string | null {
  if (input.mismatched) {
    return `Earlier details for ${input.mismatched.tenant} will be marked as moved out when you save.`;
  }
  const { scheduleTenant, lastPast } = input;
  if (scheduleTenant !== null && lastPast && sameTenantName(lastPast.tenant, scheduleTenant)) {
    return `${scheduleTenant} moved out on ${formatDay(lastPast.moveOut)}. Saving details here starts a new tenancy for ${scheduleTenant}.`;
  }
  return null;
}
