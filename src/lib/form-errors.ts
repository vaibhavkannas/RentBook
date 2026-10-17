import { apiErrorMessage } from "@/lib/request-copy";

/**
 * Where an error message goes in a form. A message about a field shows under that field; a message that is about the
 * whole form (offline, signed out, a conflict) shows in the form's own box. Both come from here as a FormProblem. Pure on
 * purpose, so the rules can be tested; the forms only show what these functions say.
 */

/**
 * One thing wrong with a form. `field` is the form's own name for the field it is about, null for the form as a whole.
 * `row` is which row of a form that has one for each portion (the settings): the portion's id.
 */
export type FormProblem = { message: string; field: string | null; row: string | null };

/** A message about the form as a whole: it goes in the form's own box. */
export const plainProblem = (message: string): FormProblem => ({ message, field: null, row: null });

/**
 * A message about `field`, if the form has such a field (`known`). A form that does not have it, or a message with no
 * field, shows the message in the form's own box.
 */
export function fieldProblem(
  message: string,
  field: string | null | undefined,
  known: readonly string[],
  row: string | null = null,
): FormProblem {
  if (field === null || field === undefined || !known.includes(field)) return plainProblem(message);
  return { message, field, row };
}

/** The message, if it is about `field` (in `row`): what that field shows under it. */
export function problemAt(problem: FormProblem | null, field: string, row: string | null = null): string | null {
  return problem !== null && problem.field === field && problem.row === row ? problem.message : null;
}

/** The message, if it is about the form as a whole: what the form's own box shows. */
export function plainMessage(problem: FormProblem | null): string | null {
  return problem !== null && problem.field === null ? problem.message : null;
}

/**
 * The problem after something was typed in `field` (in `row`): typing in a field clears what was said about that field.
 * A message about another field stays, since that field is still wrong. A message about the form as a whole is cleared
 * by any typing, because what it said (offline, a failed save) may no longer hold.
 */
export function afterEdit(problem: FormProblem | null, field: string, row: string | null = null): FormProblem | null {
  if (problem === null) return null;
  if (problem.field === null) return null;
  return problem.field === field && problem.row === row ? null : problem;
}

/** The fields of a tenancy that a request names as `fields.X` (the tenancy form) or `tenancy.X` (the New tenant sheet). */
const TENANCY_FIELDS = ["phone", "moveIn", "agreementEnd", "advance", "advanceDate", "notes"];

/** The fields the move-out request names on their own. */
const MOVE_OUT_FIELDS = ["moveOut", "refund", "deductions"];

/** The settings' fields a request names as `portions.N.X`, and what the form calls them. */
const PORTION_FIELDS: Record<string, string> = { name: "name", cycleLength: "cycle", hikePercent: "hike" };

/**
 * The form field a server answer's `details.field` is about, in the forms' own names, and the row (a position in the
 * request's list) when it is in one. Null for anything the forms have no field for (the month, an id, a token).
 */
export function fieldFromServer(path: unknown): { field: string; row: number | null } | null {
  if (typeof path !== "string") return null;
  if (path === "amount") return { field: "amount", row: null };
  if (path === "dateReceived") return { field: "date", row: null };
  if (path === "newTenantName") return { field: "tenantName", row: null };
  if (MOVE_OUT_FIELDS.includes(path)) return { field: path, row: null };
  const tenancy = /^(?:tenancy|fields)\.([A-Za-z]+)$/.exec(path);
  if (tenancy) return TENANCY_FIELDS.includes(tenancy[1]) ? { field: tenancy[1], row: null } : null;
  const portion = /^portions\.(\d+)\.([A-Za-z]+)$/.exec(path);
  if (portion && Object.hasOwn(PORTION_FIELDS, portion[2])) return { field: PORTION_FIELDS[portion[2]], row: Number(portion[1]) };
  return null;
}

/**
 * What a form shows for an error answer from the server: its words (apiErrorMessage), beside the field the answer names
 * when the form has that field, else in the form's own box. `rowIds` are the ids of the rows, in the order the request
 * listed them, to find the row of a `portions.N.X` field.
 */
export function serverProblem(
  error: { code?: string; message?: string; details?: Record<string, unknown> } | null | undefined,
  known: readonly string[],
  rowIds: readonly string[] = [],
): FormProblem {
  const message = apiErrorMessage(error);
  const named = fieldFromServer(error?.details?.field);
  if (named === null) return plainProblem(message);
  if (named.row === null) return fieldProblem(message, named.field, known);
  const row = rowIds[named.row];
  return row === undefined ? plainProblem(message) : fieldProblem(message, named.field, known, row);
}

/** The fields inside the closed "Tenancy details" box of the New tenant sheet: an error in one of them opens the box. */
export const NEW_TENANT_DETAIL_FIELDS = ["moveIn", "advance", "advanceDate", "agreementEnd", "phone"] as const;

export const isDetailField = (field: string | null): boolean =>
  field !== null && (NEW_TENANT_DETAIL_FIELDS as readonly string[]).includes(field);
