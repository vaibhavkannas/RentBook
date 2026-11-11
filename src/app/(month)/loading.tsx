import { Page } from "@/components/ui/Page";
import { Skeleton } from "@/components/ui/Skeleton";

/** How many portion rows the placeholder shows: the five of the usual building. */
const ROWS = 5;

/**
 * Shown straight away when the month screen is opened (the Month tab, the arrow back from another screen, Try again), while the
 * page reads the Sheet. It is laid out like the screen it stands in for, so nothing moves when the figures arrive: the header
 * with its arrows and the refresh button, the summary card with its ring, the filter chips, and a row for each portion (64 px,
 * like the real ones). Switching month never shows it: the months are already on the page.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <p className="sr-only">Loading this month…</p>

      <div aria-hidden="true">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Skeleton className="size-11" />
            <Skeleton className="h-6 w-36" />
            <Skeleton className="size-11" />
          </div>
          <Skeleton className="size-11 rounded-full!" />
        </div>

        <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-card border border-line bg-surface p-4">
          <Skeleton className="size-21 rounded-full!" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="col-span-2 flex gap-2">
            <Skeleton className="h-11 w-36" />
            <Skeleton className="h-11 w-32" />
          </div>
        </div>

        <div className="mt-2 flex gap-2 py-1">
          <Skeleton className="h-11 w-16 rounded-full!" />
          <Skeleton className="h-11 w-24 rounded-full!" />
          <Skeleton className="h-11 w-20 rounded-full!" />
          <Skeleton className="h-11 w-24 rounded-full!" />
        </div>

        <div className="grid gap-2">
          {Array.from({ length: ROWS }, (_, row) => (
            <div key={row} className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-line bg-surface p-3">
              <Skeleton className="size-9 rounded-full!" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}
