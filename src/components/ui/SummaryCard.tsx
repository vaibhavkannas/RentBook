import type { ReactNode } from "react";
import { SUMMARY_CARD } from "@/lib/ui-classes";

type Props = {
  /** What the figure is ("Owed"). */
  label: string;
  /** The big figure ("₹ 9,000"). */
  figure: ReactNode;
  /** A line under it. */
  note?: ReactNode;
  /** The section's name for a screen reader. */
  ariaLabel: string;
  /** Layout only: a margin. */
  className?: string;
  /** More inside the card (a bar). */
  children?: ReactNode;
};

/** The card at the top of Overdue rent and Year at a glance: a small label, the figure in the display face, and a line under it. */
export function SummaryCard({ label, figure, note, ariaLabel, className = "mt-3", children }: Props) {
  return (
    <section aria-label={ariaLabel} className={`${SUMMARY_CARD} ${className}`}>
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-bold leading-tight tabular-nums">{figure}</p>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      {children}
    </section>
  );
}
