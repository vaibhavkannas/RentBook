import { z } from "zod";

const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-10");

export const paymentBody = z.object({
  month: monthString,
  portionId: z.string().min(1).max(20),
  amount: z.number(),
  dateReceived: z.string(),
  newTenantName: z.string().optional(),
  overwrite: z.boolean().optional(),
});

export const undoBody = z.object({
  month: monthString,
  portionId: z.string().min(1).max(20),
  expected: z.object({ tenant: z.string(), count: z.number(), amount: z.number() }),
});

export const logRetryBody = z.object({
  row: z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.number(),
    z.number(),
    z.string(),
    z.string(),
    z.enum(["Logged", "Edited", "Undone"]),
  ]),
});

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
