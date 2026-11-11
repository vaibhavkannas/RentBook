import { redirect } from "next/navigation";
import AttentionCard from "@/components/AttentionCard";
import ExitGuard from "@/components/ExitGuard";
import LoadProblem from "@/components/LoadProblem";
import MonthScreen from "@/components/MonthScreen";
import { Page } from "@/components/ui/Page";
import { attentionFor } from "@/lib/attention";
import type { MonthView } from "@/lib/domain/types";
import { currentYm, parseYmKey, todayIso, ymKey } from "@/lib/domain/year-month";
import { monthWindow, windowViews } from "@/lib/month-window";
import type { AttentionItem } from "@/lib/report-copy";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { loadMonthView, loadPageSnapshot } from "@/lib/server/freshness";
import { errorLogFields, logEvent } from "@/lib/server/log";
import { problemMessage, setupHrefFor } from "@/lib/server/problem";

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
  const current = currentYm(now);
  const month = (param ? parseYmKey(param) : null) ?? current;

  let view: MonthView | null = null;
  let problem: string | null = null;
  let setupHref: string | undefined;
  try {
    view = await loadMonthView(getSheetsContext(), month, viewer.email);
  } catch (error) {
    problem = problemMessage(error, viewer);
    setupHref = setupHrefFor(error, viewer, ymKey(month));
  }

  // The page carries the months around this one, so the screen can switch between them with no request. They are all derived
  // from the snapshot the month view just read (the same cache entry, so no further Google read), and so is the Needs
  // attention card, which belongs to the current month. When that read fails the page keeps the one month it has, and shows
  // no card: the month view reports the problems.
  let views: Record<string, MonthView> = {};
  let attention: AttentionItem[] = [];
  if (view) {
    views = { [ymKey(month)]: view };
    try {
      const snapshot = await loadPageSnapshot(getSheetsContext(), viewer.email);
      views = windowViews(snapshot, monthWindow(current, month), view);
      attention = attentionFor(snapshot, todayIso(now), ymKey(current));
    } catch (error) {
      logEvent("warn", "attention-card-failed", errorLogFields(error, "The Needs attention card could not be built"));
    }
  }

  return (
    <Page>
      <MonthScreen
        monthKey={ymKey(month)}
        currentKey={ymKey(current)}
        today={todayIso(now)}
        renderedAt={now.getTime()}
        views={views}
        attention={<AttentionCard items={attention} />}
        problem={problem && <LoadProblem message={problem} retryHref={`/?month=${ymKey(month)}`} setupHref={setupHref} />}
      />

      <ExitGuard />
    </Page>
  );
}
