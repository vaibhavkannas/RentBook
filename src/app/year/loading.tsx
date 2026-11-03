import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/** How many portion cards the placeholder shows, each with the twelve months of a year in two rows of six. */
const PORTION_CARDS = 2;

/**
 * Shown straight away when Year at a glance is opened, while the page reads the Sheet. The header, with its arrow back to the
 * month, is the page's own; under it are the year between its arrows, the total with its bar, the key, and two cards laid out
 * like the real ones (the name, what was received, twelve 44 px months in six columns), so nothing moves when the figures arrive.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Year at a glance" back={{ href: "/", label: "Back to month" }} />
      <p className="sr-only">Loading year at a glance…</p>

      <div aria-hidden="true">
        <div className="mt-3 flex items-center justify-between">
          <Skeleton className="size-11" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="size-11" />
        </div>

        <Card className="mt-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="mt-0.5 h-8 w-56" />
          <Skeleton className="mt-2 h-1.5 w-full" />
        </Card>

        <div className="mt-3 flex gap-x-4">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>

        <div className="mt-3 space-y-3">
          {Array.from({ length: PORTION_CARDS }, (_, card) => (
            <Card key={card}>
              <Skeleton className="h-6 w-44" />
              <Skeleton className="mt-0.5 h-5 w-40" />
              <div className="mt-2 grid grid-cols-6 gap-1.5">
                {Array.from({ length: 12 }, (_, month) => (
                  <Skeleton key={month} className="h-11" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Page>
  );
}
