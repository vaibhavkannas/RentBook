import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { CHIP_ROW } from "@/lib/ui-classes";

/** The chips of the two rows the page draws: what happened (All, Logged, Changed, Undone), then the portion. */
const CHIP_ROWS = [
  ["w-12", "w-20", "w-24", "w-20"],
  ["w-28", "w-32", "w-36"],
];

/**
 * Shown straight away when the Activity tab is tapped, while the page reads the Payments Log. It is the page without
 * its words: the header, the two rows of filter chips, a day heading and three entries, each the height of the real
 * one (a two line sentence), so nothing moves when the entries arrive. Activity is a tab, so there is no arrow back.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Activity" />
      <p className="sr-only">Loading activity…</p>

      <div aria-hidden="true" className="mt-1">
        {CHIP_ROWS.map((widths, row) => (
          <div key={row} className={CHIP_ROW}>
            {widths.map((width, chip) => (
              <Skeleton key={chip} className={`h-11 ${width} shrink-0`} />
            ))}
          </div>
        ))}
      </div>

      <div aria-hidden="true" className="mt-2">
        <div className="py-2">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((entry) => (
            <Card key={entry} className="space-y-1">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-5 w-14" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <div className="py-1">
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-5 w-1/2" />
            </Card>
          ))}
        </div>
      </div>
    </Page>
  );
}
