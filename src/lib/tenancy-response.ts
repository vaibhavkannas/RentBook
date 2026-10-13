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

/** The address of a portion's tenant details page. */
export function tenantsPagePath(portionId: string): string {
  return `/tenants/${encodeURIComponent(portionId)}`;
}

/** The same page, asking it to show TENANCY_CONFLICT_MESSAGE. A normal visit has no such part. */
export function changedPagePath(portionId: string): string {
  return `${tenantsPagePath(portionId)}?changed=1`;
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
export function pageAfterConflict(portionId: string, noticeShown: boolean): PageMove {
  return noticeShown
    ? { kind: "refresh" }
    : { kind: "replace", url: changedPagePath(portionId), scroll: true };
}

/**
 * After a save went through the page is loaded again. When the conflict notice is showing, the plain address is
 * opened instead, so the notice goes away; the page stays where it is.
 */
export function pageAfterSave(portionId: string, noticeShown: boolean): PageMove {
  return noticeShown
    ? { kind: "replace", url: tenantsPagePath(portionId), scroll: false }
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
