import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { withMonth, yearHref } from "@/lib/app-nav";
import type { MonthView } from "@/lib/domain/types";
import { ymKey } from "@/lib/domain/year-month";
import { formatRupees } from "@/lib/format";
import { summaryCounts, summaryText } from "@/lib/month-summary";
import { describeDifference, progressPercent } from "@/lib/rent-difference";

const LINK = "press inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-line bg-surface px-2 text-[13px] font-medium";

/**
 * The month's figures: a ring that fills with the share of the rent collected, what was received of what is due, how many
 * portions have paid, and the ways on to the Year screen and the Overdue rent. `status` is the "Updated" mark that goes on the
 * meta line (the screen draws it, so a refresh redraws that one line and not this card).
 */
export default function MonthSummary({ view, status }: { view: MonthView; status?: ReactNode }) {
  const key = ymKey(view.month);
  // While some portion that is let has not paid yet, the total can still change: "so far". A vacant portion owes nothing.
  const counts = summaryCounts(view);
  const difference = describeDifference(view.difference, counts.paid < counts.let);
  return (
    <section
      aria-label="Month summary"
      className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-card border border-line bg-surface p-4 shadow-card"
    >
      <ProgressRing percent={progressPercent(view.received, view.due)} />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-muted">Collected</p>
        <p className="mt-0.5 font-display text-2xl font-bold leading-tight tabular-nums">
          {formatRupees(view.received)} <span className="font-sans text-sm font-medium text-muted">of {formatRupees(view.due)}</span>
        </p>
        {difference && (
          <p className={`mt-0.5 text-sm ${difference.tone === "more" ? "text-success-ink" : "text-warn-ink"}`}>{difference.text}</p>
        )}
        <p className="mt-0.5 text-sm text-muted">
          {summaryText(view)}
          {status}
        </p>
      </div>
      <div className="col-span-2 flex gap-2">
        <Link href={yearHref(view.month.year, key)} className={LINK}>
          <Icon name="grid" />
          Year at a glance
        </Link>
        <Link href={withMonth("/overdue", key)} className={LINK}>
          <Icon name="warn" />
          Overdue rent
        </Link>
      </div>
    </section>
  );
}
