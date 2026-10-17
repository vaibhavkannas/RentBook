import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shown straight away when Details is tapped, while the page reads the Sheet. The back link works at once;
 * the title and the two cards are placeholders for the portion name, the current tenancy and the move-out section.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title={null} back={{ href: "/", label: "Back to month" }} />
      <p className="sr-only">Loading tenant details…</p>

      <Card aria-hidden="true" className="mt-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-11 w-24" />
      </Card>

      <Card aria-hidden="true" className="mt-4 space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-11 w-28" />
      </Card>
    </Page>
  );
}
