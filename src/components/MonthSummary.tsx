import Link from "next/link";
import type { MonthView } from "@/lib/domain/types";
import { ymKey } from "@/lib/domain/year-month";
import { yearHref } from "@/lib/app-nav";
import { formatRupees } from "@/lib/format";
import { summaryCounts, summaryText } from "@/lib/month-summary";
import { describeDifference, progressPercent } from "@/lib/rent-difference";

/** The month's figures: what was received of what is due, the progress, and the way to the Year screen. */
export default function MonthSummary({ view }: { view: MonthView }) {
  const key = ymKey(view.month);
  const progress = progressPercent(view.received, view.due);
  // While some portion that is let has not paid yet, the total can still change: "so far". A vacant portion owes nothing.
  const counts = summaryCounts(view);
  const difference = describeDifference(view.difference, counts.paid < counts.let);
  return (
    <section className="mt-3 rounded-card bg-surface p-4 ring-1 ring-line" aria-label="Month summary">
      <div className="flex items-baseline justify-between text-sm text-muted">
        <span>Received</span>
        <span>{summaryText(view)}</span>
      </div>
      <p className="mt-0.5 text-2xl font-semibold">
        {formatRupees(view.received)} <span className="text-sm font-normal text-muted">of {formatRupees(view.due)}</span>
      </p>
      {difference && (
        <p className={`mt-0.5 text-sm ${difference.tone === "more" ? "text-success-ink" : "text-warn-ink"}`}>{difference.text}</p>
      )}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
        <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
      </div>
      {/* The link's 44 px give the card's bottom padding back, so the card grows by the link's text only. */}
      <Link
        href={yearHref(view.month.year, key)}
        className="press -mb-2 mt-0.5 inline-flex min-h-11 items-center text-sm text-muted underline"
      >
        Year at a glance
      </Link>
    </section>
  );
}
