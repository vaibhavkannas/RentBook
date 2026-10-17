import "server-only";
import { z } from "zod";
import { MAX_NAME_LENGTH } from "@/lib/domain/input-rules";
import { ADVANCE_STATUSES, MAX_NOTES_LENGTH, MAX_PHONE_LENGTH } from "@/lib/domain/tenancy";
import { PAGE_OUT_OF_DATE_MESSAGE } from "@/lib/errors";
import { isoDay, MAX_TEXT, safeText } from "./validators";

// A custom issue (not a regex check), so the message is shown as it stands: the person never types a month, the page sends it.
const monthString = z.string().superRefine((month, ctx) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    ctx.addIssue({ code: "custom", message: "That month isn't valid. Open it again from the month screen." });
  }
});

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

/** Prepare my Sheet sends no details: it is one request, from the owner, to make the tabs. */
export const prepareBody = z.object({}).strict();

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

/**
 * Create (no `id`) or update (`id` plus the `expectedUpdatedAt` the person saw). An empty `expectedUpdatedAt` is valid:
 * a hand-typed row can have none.
 * A create names a tenant who is about to be written to the Tenants tab, so the name is checked like any new one. An
 * update sends back the name already stored there, which the service ignores, and a hand-typed row can hold a name a
 * create would refuse (long, or with a line break): that must not stop the owner editing the phone, notes or dates.
 */
export const tenancyBody = z
  .object({
    portionId: z.string().min(1).max(20),
    tenant: z.string().superRefine((tenant, ctx) => {
      if (tenant.length > MAX_TEXT) ctx.addIssue({ code: "custom", message: "Tenant name is too long." });
    }),
    id: z.string().min(1).max(MAX_TEXT).optional(),
    expectedUpdatedAt: z.string().max(MAX_TEXT).optional(),
    fields: tenancyFieldsSchema,
  })
  .refine((body) => body.id === undefined || body.expectedUpdatedAt !== undefined, {
    message: PAGE_OUT_OF_DATE_MESSAGE,
    path: ["expectedUpdatedAt"],
  })
  .superRefine((body, ctx) => {
    if (body.id !== undefined) return;
    const checked = tenantName.safeParse(body.tenant);
    if (checked.success) return;
    for (const issue of checked.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: ["tenant"] });
    }
  })
  .transform((body) => (body.id === undefined ? { ...body, tenant: body.tenant.trim() } : body));

/** The body of a move-out of details on file: the tenancy, as the person saw it, and what happened to the advance. */
type CloseTenancyBody = {
  id: string;
  expectedUpdatedAt: string;
  moveOut: string;
  advanceStatus?: (typeof ADVANCE_STATUSES)[number] | null;
  refund?: number | null;
  deductions?: number | null;
  notes?: string;
};

/** The body of a move-out where no details were ever added: the tenant the Schedule names for the portion, and the day. */
type RecordMoveOutBody = { portionId: string; tenant: string; moveOut: string; notes?: string };

/**
 * A move-out, of one of two kinds. With an `id` it closes the details on file for that tenancy (`id` and the
 * `expectedUpdatedAt` the person saw, the day, and optionally what happened to the advance, the refund, the deductions and
 * notes). Without one it records that the tenant the Schedule names for a portion has moved out (`portionId`, `tenant`, the
 * day and optionally notes), for a portion that has no details on file. A body with an id is always the first kind, and
 * gives back only what it was sent; the other kind gives back only its own fields. A body that is neither says the page is
 * out of date, as a tenancy's does.
 */
export const moveOutBody = z
  .object({
    id: z.string().min(1).max(MAX_TEXT).optional(),
    expectedUpdatedAt: z.string().max(MAX_TEXT).optional(),
    portionId: z.string().min(1).max(20).optional(),
    tenant: tenantName.optional(),
    moveOut: isoDay("Move-out date"),
    advanceStatus: z.enum(ADVANCE_STATUSES).nullable().optional(),
    refund: z.number().nullable().optional(),
    deductions: z.number().nullable().optional(),
    notes: safeText(MAX_NOTES_LENGTH, { label: "Notes", allowNewlines: true }).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.id !== undefined) {
      if (body.expectedUpdatedAt === undefined) {
        ctx.addIssue({ code: "custom", message: PAGE_OUT_OF_DATE_MESSAGE, path: ["expectedUpdatedAt"] });
      }
    } else if (body.portionId === undefined || body.tenant === undefined) {
      ctx.addIssue({ code: "custom", message: PAGE_OUT_OF_DATE_MESSAGE, path: ["id"] });
    }
  })
  .transform((body): CloseTenancyBody | RecordMoveOutBody => {
    if (body.id !== undefined) {
      const close: CloseTenancyBody = { id: body.id, expectedUpdatedAt: body.expectedUpdatedAt!, moveOut: body.moveOut };
      if (body.advanceStatus !== undefined) close.advanceStatus = body.advanceStatus;
      if (body.refund !== undefined) close.refund = body.refund;
      if (body.deductions !== undefined) close.deductions = body.deductions;
      if (body.notes !== undefined) close.notes = body.notes;
      return close;
    }
    const record: RecordMoveOutBody = { portionId: body.portionId!, tenant: body.tenant!, moveOut: body.moveOut };
    if (body.notes !== undefined) record.notes = body.notes;
    return record;
  });
