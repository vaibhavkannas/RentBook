/** How the tenant forms describe a save that did not succeed. Pure, so the wording can be tested. */

export const TENANCY_CONFLICT_MESSAGE =
  "This changed just now. The page was updated, please check and save again.";

export const TENANCY_NO_CONFIRMATION =
  "Couldn't confirm that the save went through. Check your connection and refresh the page before trying again.";

/** The JSON the tenancy routes answer with. */
export type TenancyApiBody = {
  ok: boolean;
  error?: { code: string; message: string };
};

/**
 * What to tell the person, and whether the page behind the form is out of date.
 * `null` means no answer arrived (a network failure).
 */
export function saveFailure(body: TenancyApiBody | null): { message: string; refresh: boolean } {
  if (body === null) return { message: TENANCY_NO_CONFIRMATION, refresh: false };
  const error = body.error;
  if (error?.code === "conflict") return { message: TENANCY_CONFLICT_MESSAGE, refresh: true };
  return { message: error?.message ?? "Something went wrong. Try again.", refresh: false };
}
