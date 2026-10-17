import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shown straight away when Portion settings is tapped, while the page reads the Settings tab: the header, with its arrow
 * back to More, and two cards where the first portions' fields will be.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Portion settings" back={{ href: "/more", label: "Back to More" }} />
      <p className="sr-only">Loading portion settings…</p>

      <div aria-hidden="true" className="mt-3 space-y-3">
        {[0, 1].map((portion) => (
          <Card key={portion} className="space-y-3">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
            <Skeleton className="h-5 w-40" />
          </Card>
        ))}
      </div>
    </Page>
  );
}
