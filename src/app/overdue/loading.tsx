import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/** How many months each of the two placeholder cards lists. */
const MONTHS_IN_CARD = [1, 2];

/**
 * Shown straight away when Overdue rent is opened, while the page reads the Sheet. The header, with its arrow back to the
 * month, is the page's own; under it are the total with its line, and two cards laid out like the real ones: the portion and
 * its amount, who owes, the oldest month, and a 44 px row for each month, so nothing moves when the figures arrive.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Overdue rent" back={{ href: "/", label: "Back to month" }} />
      <p className="sr-only">Loading overdue rent…</p>

      <div aria-hidden="true">
        <Card className="mt-3 space-y-1">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-5 w-64" />
        </Card>

        <div className="mt-3 space-y-3">
          {MONTHS_IN_CARD.map((months, card) => (
            <Card key={card}>
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-5 w-16" />
              </div>
              <div className="mt-1 space-y-1">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
              </div>
              <div className="mt-2 space-y-px">
                {Array.from({ length: months }, (_, month) => (
                  <Skeleton key={month} className="h-11 w-full" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Page>
  );
}
