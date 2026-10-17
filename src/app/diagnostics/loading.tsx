import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/** How many rows each section has on the page, which the placeholders follow: App, Google Sheet, Tabs, Problems. */
const ROWS_IN_SECTION = [3, 1, 4, 1];

/**
 * Shown straight away when Diagnostics is tapped, while the page reads the Sheet (up to three calls to Google one after
 * another). The header, with its arrow back to More, is the page's own; under it are the intro and a card for each of the four
 * sections with a title and as many rows as the real card has, so the page does not jump.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Diagnostics" back={{ href: "/more", label: "Back to More" }} />
      <p className="sr-only">Loading diagnostics…</p>

      <div aria-hidden="true">
        <div className="mt-3 space-y-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>

        <div className="mt-3 space-y-3">
          {ROWS_IN_SECTION.map((rows, section) => (
            <Card key={section}>
              <Skeleton className="h-6 w-32" />
              <div className="mt-3 space-y-3">
                {Array.from({ length: rows }, (_, row) => (
                  <Skeleton key={row} className="h-4 w-full" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Page>
  );
}
