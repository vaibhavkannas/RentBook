import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/** How many placeholder cards each of the two sections shows. */
const CARDS_IN_SECTION = [2, 1];

/**
 * Shown straight away when Agreements and hikes is opened, while the page reads the Sheet. The header, with its arrow back to
 * the month, is the page's own; under it are the two sections with a heading and cards laid out like the real ones (the portion
 * and its pill, the tenant, a two line sentence, the Details link), so nothing moves when the alerts arrive.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Agreements and hikes" back={{ href: "/", label: "Back to month" }} />
      <p className="sr-only">Loading agreements and hikes…</p>

      <div aria-hidden="true">
        {CARDS_IN_SECTION.map((cards, section) => (
          <div key={section} className={section === 0 ? "mt-4" : "mt-6"}>
            <Skeleton className="h-4 w-24" />
            <div className="mt-2 space-y-3">
              {Array.from({ length: cards }, (_, card) => (
                <Card key={card}>
                  <div className="flex items-start justify-between gap-3">
                    <Skeleton className="h-6 w-44" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="mt-0.5 h-5 w-24" />
                  <div className="mt-1 space-y-1">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-2/3" />
                  </div>
                  {section === 0 && <Skeleton className="mt-2 h-11 w-24 rounded-control" />}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
