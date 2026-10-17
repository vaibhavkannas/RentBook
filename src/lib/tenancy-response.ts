import { withMonth } from "@/lib/app-nav";
import { plainProblem, serverProblem, type FormProblem } from "@/lib/form-errors";

/** How the tenant forms describe a save that did not succeed. Pure, so the wording can be tested. */

/**
 * What the tenant details page shows after a conflict. The page shows it, not the form: the refreshed page can
 * replace the form, and a message kept inside the form would go with it.
 */
export const TENANCY_CONFLICT_MESSAGE =
  "This changed just now. The page was updated. Please check and save again.";

export const TENANCY_NO_CONFIRMATION =
  "Couldn't confirm that the save went through. Check your connection and refresh the page before trying again.";

/** The JSON the tenancy routes answer with. */
export type TenancyApiBody = {
  ok: boolean;
  error?: { code: string; message: string; details?: Record<string, unknown> };
};

/**
 * What to tell the person, and whether the page behind the form is out of date. The message goes beside the field the
 * server named when the form (`known`, its own field names) has that field, else in the form's own box.
 * `null` means no answer arrived (a network failure).
 */
export function saveFailure(
  body: TenancyApiBody | null,
  known: readonly string[],
): { problem: FormProblem; refresh: boolean } {
  if (body === null) return { problem: plainProblem(TENANCY_NO_CONFIRMATION), refresh: false };
  const error = body.error;
  if (error?.code === "conflict") return { problem: plainProblem(TENANCY_CONFLICT_MESSAGE), refresh: true };
  return { problem: serverProblem(error, known), refresh: false };
}

/**
 * The address of a portion's tenant details page. `monthKey` is the month the person opened it from: the page keeps it
 * in its address, so that its arrow back leads to that month again.
 */
export function tenantsPagePath(portionId: string, monthKey?: string | null): string {
  return withMonth(`/tenants/${encodeURIComponent(portionId)}`, monthKey);
}

/** The same page, asking it to show TENANCY_CONFLICT_MESSAGE. A normal visit has no such part. */
export function changedPagePath(portionId: string, monthKey?: string | null): string {
  return withMonth(`/tenants/${encodeURIComponent(portionId)}?changed=1`, monthKey);
}

/** Whether the page was opened after a conflict. `searchParams` is what Next gives the page, once awaited. */
export function showChangedNotice(searchParams: Record<string, string | string[] | undefined> | undefined): boolean {
  const changed = searchParams?.changed;
  return Array.isArray(changed) ? changed.includes("1") : changed === "1";
}

/** What a form does to the page it is on: load it again as it is, or open another address. */
export type PageMove =
  | { kind: "refresh" }
  | { kind: "replace"; url: string; scroll: boolean };

/**
 * After a conflict the page is opened again with the notice (scrolled to the top, where the notice is). When the
 * notice is already showing, loading the page again is enough.
 */
export function pageAfterConflict(portionId: string, noticeShown: boolean, monthKey?: string | null): PageMove {
  return noticeShown
    ? { kind: "refresh" }
    : { kind: "replace", url: changedPagePath(portionId, monthKey), scroll: true };
}

/**
 * After a save went through the page is loaded again. When the conflict notice is showing, the plain address is
 * opened instead, so the notice goes away; the page stays where it is.
 */
export function pageAfterSave(portionId: string, noticeShown: boolean, monthKey?: string | null): PageMove {
  return noticeShown
    ? { kind: "replace", url: tenantsPagePath(portionId, monthKey), scroll: false }
    : { kind: "refresh" };
}

/** Does the move with the router of next/navigation (anything with these two methods works). */
export function applyPageMove(
  router: { refresh: () => void; replace: (url: string, options?: { scroll?: boolean }) => void },
  move: PageMove,
): void {
  if (move.kind === "refresh") router.refresh();
  else router.replace(move.url, { scroll: move.scroll });
}
