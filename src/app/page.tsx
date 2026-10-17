import { redirect } from "next/navigation";
import ExitGuard from "@/components/ExitGuard";
import LoadProblem from "@/components/LoadProblem";
import MonthFrame from "@/components/MonthFrame";
import PortionBoard from "@/components/PortionBoard";
import { Page } from "@/components/ui/Page";
import type { MonthView } from "@/lib/domain/types";
import { currentYm, parseYmKey, todayIso, ymKey } from "@/lib/domain/year-month";
import { formatMonthTitle, formatRupees } from "@/lib/format";
import { describeDifference, progressPercent } from "@/lib/rent-difference";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { loadMonthView } from "@/lib/server/freshness";
import { problemMessage } from "@/lib/server/problem";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");

  const { month: param } = await searchParams;
  const now = new Date();
  const month = (param ? parseYmKey(param) : null) ?? currentYm(now);

  let view: MonthView | null = null;
  let problem: string | null = null;
  try {
    view = await loadMonthView(getSheetsContext(), month, viewer.email);
  } catch (error) {
    problem = problemMessage(error, viewer);
  }

  const title = formatMonthTitle(month);
  const progress = view ? progressPercent(view.received, view.due) : 0;
  // While some portions have not paid yet, the total can still change: "so far".
  const difference = view
    ? describeDifference(view.difference, view.paidCount < view.cards.length)
    : null;

  return (
    <Page>
      <MonthFrame monthKey={ymKey(month)} currentKey={ymKey(currentYm(now))}>
        {problem && <LoadProblem message={problem} retryHref={`/?month=${ymKey(month)}`} />}

        {view && (
          <>
            <section className="mt-3 rounded-card bg-surface p-4 ring-1 ring-line" aria-label="Month summary">
              <div className="flex items-baseline justify-between text-sm text-muted">
                <span>Received</span>
                <span>
                  {view.paidCount} of {view.cards.length} portions
                </span>
              </div>
              <p className="mt-0.5 text-2xl font-semibold">
                {formatRupees(view.received)}{" "}
                <span className="text-sm font-normal text-muted">of {formatRupees(view.due)}</span>
              </p>
              {difference && (
                <p
                  className={`mt-0.5 text-sm ${
                    difference.tone === "more" ? "text-success-ink" : "text-warn-ink"
                  }`}
                >
                  {difference.text}
                </p>
              )}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
                <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
            </section>

            <PortionBoard
              monthKey={ymKey(month)}
              monthLabel={title}
              cards={view.cards}
              defaultDate={todayIso(now)}
            />
          </>
        )}
      </MonthFrame>

      <ExitGuard />
    </Page>
  );
}
