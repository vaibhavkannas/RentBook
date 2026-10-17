import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shown straight away when the Activity tab is tapped, while the page reads the Payments Log: the header, a row of
 * filter chips and three entries. Activity is a tab, so there is no arrow back.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Activity" />
      <p className="sr-only">Loading activity…</p>

      <div aria-hidden="true" className="mt-3 flex gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>

      <div aria-hidden="true" className="mt-3 space-y-3">
        {[0, 1, 2].map((entry) => (
          <Card key={entry} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
        ))}
      </div>
    </Page>
  );
}
