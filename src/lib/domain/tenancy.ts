import { validation } from "@/lib/errors";
import { wholeRupeesMessage } from "@/lib/format";
import { cleanText, MAX_NAME_LENGTH, requireDay } from "./input-rules";

/** What became of a tenant's advance. */
export const ADVANCE_STATUSES = ["Held", "Refunded", "Adjusted"] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

export const isAdvanceStatus = (value: unknown): value is AdvanceStatus =>
  ADVANCE_STATUSES.some((status) => status === value);

export type Tenancy = {
  /** 1-based row in the Tenants tab. Not stored. */
  rowNumber: number;
  id: string;
  portionId: string;
  tenant: string;
  phone: string;
  moveIn: string; // YYYY-MM-DD
  agreementEnd: string; // YYYY-MM-DD or ""
  advance: number | null;
  advanceDate: string; // YYYY-MM-DD or ""
  advanceStatus: AdvanceStatus | null;
  refund: number | null;
  deductions: number | null;
  notes: string;
  moveOut: string; // YYYY-MM-DD or "" while current
  updatedBy: string;
  updatedAt: string; // ISO timestamp
};

/** What a portion card needs. */
export type TenancySummary = Pick<
  Tenancy,
  "id" | "phone" | "moveIn" | "agreementEnd" | "advance" | "advanceStatus" | "updatedAt"
>;

/** Fields a person can enter when creating or editing a tenancy. */
export type TenancyFields = {
  phone?: string;
  moveIn: string;
  agreementEnd?: string;
  advance?: number | null;
  advanceDate?: string;
  notes?: string;
};

/** The most one amount of rent, advance, refund or deduction may be, in whole rupees. */
export const MAX_RUPEES = 10_000_000;

export const MAX_PHONE_LENGTH = 30;
export const MAX_NOTES_LENGTH = 500;

/** Whether two tenant names are the same person's name: surrounding spaces and case are ignored. */
export function sameTenantName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The last row of the portion that has no move-out date, or null. */
export function currentTenancy(all: Tenancy[], portionId: string): Tenancy | null {
  for (let index = all.length - 1; index >= 0; index--) {
    const candidate = all[index];
    if (candidate.portionId === portionId && candidate.moveOut === "") return candidate;
  }
  return null;
}

/** Closed tenancies of the portion, newest move-out first; equal dates put the higher row first. */
export function pastTenancies(all: Tenancy[], portionId: string): Tenancy[] {
  return all
    .filter((t) => t.portionId === portionId && t.moveOut !== "")
    .sort((a, b) => {
      if (a.moveOut !== b.moveOut) return a.moveOut < b.moveOut ? 1 : -1;
      return b.rowNumber - a.rowNumber;
    });
}

export function summarize(t: Tenancy): TenancySummary {
  return {
    id: t.id,
    phone: t.phone,
    moveIn: t.moveIn,
    agreementEnd: t.agreementEnd,
    advance: t.advance,
    advanceStatus: t.advanceStatus,
    updatedAt: t.updatedAt,
  };
}

/** "t-" then a random UUID: two tenancies saved at the same moment, from any server, never share an id. */
export function newTenancyId(): string {
  return `t-${crypto.randomUUID()}`;
}

/** Returns cleaned fields or throws validation() with a clear message. */
export function validateTenancyFields(
  fields: TenancyFields,
): Required<Omit<TenancyFields, "advance">> & { advance: number | null } {
  // A phone is one line of free text.
  const phone = cleanText(fields.phone, "Phone", { max: MAX_PHONE_LENGTH });

  const moveIn = (fields.moveIn ?? "").trim();
  requireDay(moveIn, "Move-in date");

  const agreementEnd = (fields.agreementEnd ?? "").trim();
  if (agreementEnd !== "") {
    requireDay(agreementEnd, "Agreement end");
    if (agreementEnd < moveIn) {
      throw validation("Agreement end cannot be before the move-in date.");
    }
  }

  const advanceDate = (fields.advanceDate ?? "").trim();
  if (advanceDate !== "") requireDay(advanceDate, "Advance date");

  const advance = fields.advance ?? null;
  if (
    advance !== null &&
    !(typeof advance === "number" && Number.isInteger(advance) && advance >= 0 && advance <= MAX_RUPEES)
  ) {
    throw validation(wholeRupeesMessage("Advance", 0, MAX_RUPEES));
  }

  const notes = cleanText(fields.notes, "Notes", { max: MAX_NOTES_LENGTH, allowNewlines: true });

  return { phone, moveIn, agreementEnd, advance, advanceDate, notes };
}

/** The tenant name as it will be stored: trimmed, 1 to 60 characters, on one line. */
export function validateTenantName(name: string): string {
  return cleanText(name, "Tenant name", { max: MAX_NAME_LENGTH, required: true });
}
