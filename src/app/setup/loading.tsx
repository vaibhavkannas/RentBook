import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/** How many checks each step has on the page, which the placeholders follow: sign-in, service account, Sheet, Schedule, tabs, portions. */
const CHECKS_IN_STEP = [7, 1, 2, 7, 6, 1];

/**
 * Shown straight away when Set up is tapped, while the page reads the environment and the Sheet (up to three calls to Google
 * one after another). The header, with its arrow back to More, is the page's own; under it are the intro, the headline and a
 * card for each of the six steps, each with a title row and as many checks as the real card has, so the page does not jump.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Set up" back={{ href: "/more", label: "Back to More" }} />
      <p className="sr-only">Loading set up…</p>

      <div aria-hidden="true">
        <div className="mt-3 space-y-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="mt-3 h-9 w-full" />

        <div className="mt-3 space-y-3">
          {CHECKS_IN_STEP.map((checks, step) => (
            <Card key={step}>
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-5 w-12" />
              </div>
              <div className="mt-3 space-y-3">
                {Array.from({ length: checks }, (_, check) => (
                  <div key={check} className="space-y-1">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Page>
  );
}
