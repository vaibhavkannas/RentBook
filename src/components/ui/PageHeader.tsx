import { Suspense } from "react";
import { BackLink, BackLinkFallback } from "./BackLink";
import { Skeleton } from "./Skeleton";

type Props = {
  /** The screen's title. `null` on a loading screen: a placeholder bar stands where the title will be. */
  title: string | null;
  /** Where the arrow leads: the path of the screen ("/" or "/more"), and `label` is what a screen reader says for it. */
  back?: { href: string; label: string };
};

/** The title of a screen, with an arrow back to where the person came from, in the month that was showing. */
export function PageHeader({ title, back }: Props) {
  const heading =
    title === null ? <Skeleton className="h-6 w-40" /> : <h1 className="text-lg font-semibold">{title}</h1>;
  if (!back) return <header className="flex min-h-11 items-center gap-2">{heading}</header>;
  return (
    <header className="flex min-h-11 items-center gap-2">
      <Suspense fallback={<BackLinkFallback href={back.href} label={back.label} />}>
        <BackLink href={back.href} label={back.label} />
      </Suspense>
      {heading}
    </header>
  );
}
