import { z } from "zod";
import { ADVANCE_STATUSES } from "@/lib/domain/tenancy";

const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-10");

/** The longest text the log requests take from the browser. */
const MAX_TEXT = 200;

/** The tenant, count and amount the person saw on screen. */
const seenEntry = z.object({ tenant: z.string().max(MAX_TEXT), count: z.number(), amount: z.number() });

/** What a person can enter for a tenancy. The service checks the values and gives a clear message. */
export const tenancyFieldsSchema = z.object({
  phone: z.string().max(MAX_TEXT).optional(),
  moveIn: z.string().max(MAX_TEXT),
  agreementEnd: z.string().max(MAX_TEXT).optional(),
  advance: z.number().nullable().optional(),
  advanceDate: z.string().max(MAX_TEXT).optional(),
  notes: z.string().optional(),
});

export const paymentBody = z.object({
  month: monthString,
  portionId: z.string().min(1).max(20),
  amount: z.number(),
  dateReceived: z.string().max(MAX_TEXT),
  newTenantName: z.string().max(MAX_TEXT).optional(),
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
        name: z.string(),
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
    tenant: z.string(),
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
  moveOut: z.string(),
  advanceStatus: z.enum(ADVANCE_STATUSES).nullable().optional(),
  refund: z.number().nullable().optional(),
  deductions: z.number().nullable().optional(),
  notes: z.string().optional(),
});
