import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/** A labelled field: a 20 px label bar over a 48 px control, as the real field is, and under it a hint of two lines if it has one. */
function FieldPlaceholder({ label, hint = false }: { label: string; hint?: boolean }) {
  return (
    <div>
      <Skeleton className={`h-5 ${label}`} />
      <Skeleton className="mt-1 h-12 w-full" />
      {hint && <Skeleton className="mt-1 h-10 w-full" />}
    </div>
  );
}

/**
 * Shown straight away when Portion settings is tapped, while the page reads the Settings tab: the header, with its arrow
 * back to More, and two cards laid out like the real ones (the name, payments per cycle with its hint, the hike, and the
 * "Count never resets" row, one under the other) with the Save button under them, so the page does not jump when it arrives.
 */
export default function Loading() {
  return (
    <Page aria-busy="true">
      <PageHeader title="Portion settings" back={{ href: "/more", label: "Back to More" }} />
      <p className="sr-only">Loading portion settings…</p>

      <div aria-hidden="true" className="mt-3 space-y-3">
        {[0, 1].map((portion) => (
          <Card key={portion} className="space-y-2">
            <FieldPlaceholder label="w-24" />
            <FieldPlaceholder label="w-32" hint />
            <FieldPlaceholder label="w-44" />
            <div className="flex min-h-11 items-center gap-2">
              <Skeleton className="size-5" />
              <Skeleton className="h-4 w-36" />
            </div>
          </Card>
        ))}
        <Skeleton className="h-12 w-full" />
      </div>
    </Page>
  );
}
