import "server-only";
import { z } from "zod";
import { MAX_NAME_LENGTH } from "@/lib/domain/input-rules";
import { ADVANCE_STATUSES, MAX_NOTES_LENGTH, MAX_PHONE_LENGTH } from "@/lib/domain/tenancy";
import { isoDay, safeText } from "./validators";

const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-10");

/** The longest text the log requests take from the browser. */
const MAX_TEXT = 200;

/** A tenant's name: the text the person typed, which the sheets will hold. */
const tenantName = safeText(MAX_NAME_LENGTH, { label: "Tenant name", required: true });

/** The tenant, count and amount the person saw on screen. */
const seenEntry = z.object({ tenant: z.string().max(MAX_TEXT), count: z.number(), amount: z.number() });

/** What a person can enter for a tenancy. The service checks the values again and gives a clear message. */
export const tenancyFieldsSchema = z.object({
  phone: safeText(MAX_PHONE_LENGTH, { label: "Phone" }).optional(),
  moveIn: isoDay("Move-in date"),
  agreementEnd: isoDay("Agreement end", { allowBlank: true }).optional(),
  advance: z.number().nullable().optional(),
  advanceDate: isoDay("Advance date", { allowBlank: true }).optional(),
  notes: safeText(MAX_NOTES_LENGTH, { label: "Notes", allowNewlines: true }).optional(),
});

export const paymentBody = z.object({
  month: monthString,
  portionId: z.string().min(1).max(20),
  amount: z.number(),
  dateReceived: isoDay("Date received"),
  newTenantName: tenantName.optional(),
  overwrite: z.boolean().optional(),
  expected: seenEntry.optional(),
  /** Details of the new tenant. Only used together with `newTenantName`. */
  tenancy: tenancyFieldsSchema.optional(),
});

export const undoBody = z.object({
  month: monthString,
  portionId: z.string().min(1).max(20),
  expected: seenEntry,
});

/** A Payments Log row as the server wrote it: saved at, month, portion, tenant, amount, count, date received, logged by, action. */
export const logRowSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
  z.number(),
  z.string(),
  z.string(),
  z.enum(["Logged", "Edited", "Undone"]),
]);

/** A retry sends back only the token the server gave it: the row inside is signed and cannot be changed. */
export const logRetryBody = z.object({ token: z.string().min(1).max(2000) });

export const settingsBody = z.object({
  portions: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        name: safeText(MAX_NAME_LENGTH, { label: "Portion name", required: true }),
        cycleLength: z.number().nullable(),
        hikePercent: z.number(),
      }),
    )
    .min(1)
    .max(20),
});

/** Create (no `id`) or update (`id` plus the `expectedUpdatedAt` the person saw). An empty `expectedUpdatedAt` is valid: a hand-typed row can have none. */
export const tenancyBody = z
  .object({
    portionId: z.string().min(1).max(20),
    tenant: tenantName,
    id: z.string().min(1).optional(),
    expectedUpdatedAt: z.string().optional(),
    fields: tenancyFieldsSchema,
  })
  .refine((body) => body.id === undefined || body.expectedUpdatedAt !== undefined, {
    message: "expectedUpdatedAt is required when id is given",
    path: ["expectedUpdatedAt"],
  });

export const moveOutBody = z.object({
  id: z.string().min(1),
  expectedUpdatedAt: z.string(),
  moveOut: isoDay("Move-out date"),
  advanceStatus: z.enum(ADVANCE_STATUSES).nullable().optional(),
  refund: z.number().nullable().optional(),
  deductions: z.number().nullable().optional(),
  notes: safeText(MAX_NOTES_LENGTH, { label: "Notes", allowNewlines: true }).optional(),
});
