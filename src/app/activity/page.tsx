import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { monthParam, withMonth } from "@/lib/app-nav";
import { formatMonthKey, formatRupees, formatSavedAt } from "@/lib/format";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readWrittenAt } from "@/lib/server/freshness";
import { problemMessage } from "@/lib/server/problem";
import { readActivity, type ActivityItem } from "@/lib/sheets/service";
import type { PillTone } from "@/lib/ui-classes";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

const PILL_TONE: Record<NonNullable<ActivityItem["action"]>, PillTone> = {
  Logged: "success",
  Edited: "warn",
  Undone: "danger",
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  // The month the person was looking at: Try again keeps it, so the tab bar and the way back still lead to it.
  const month = monthParam((await searchParams)?.month);

  let items: ActivityItem[] | null = null;
  let problem: string | null = null;
  try {
    items = await readActivity(getSheetsContext(), undefined, { minFetchedAt: await readWrittenAt(viewer.email) });
  } catch (error) {
    problem = problemMessage(error, viewer);
  }

  return (
    <Page>
      <PageHeader title="Activity" />

      {problem && <LoadProblem message={problem} retryHref={withMonth("/activity", month)} />}

      {items && items.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">Nothing has been logged yet.</p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-3 space-y-3">
          {items.map((item, index) => (
            <Card as="li" key={`${item.savedAt}-${index}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.portion}</p>
                {item.action ? (
                  <Pill tone={PILL_TONE[item.action]}>{item.action}</Pill>
                ) : (
                  // An older row from before the Action column: nothing was recorded, so say nothing.
                  <span className="shrink-0 px-2.5 py-0.5 text-xs text-muted">
                    <span className="sr-only">No action recorded</span>
                    <span aria-hidden="true">—</span>
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">
                {item.tenant}
                {item.count !== null ? ` · Payment ${item.count}` : ""} · {formatMonthKey(item.month)}
              </p>
              {item.amount !== null && <p className="mt-1 text-lg font-medium">{formatRupees(item.amount)}</p>}
              <p className="mt-1 break-words text-sm text-muted">
                {formatSavedAt(item.savedAt)} · {item.loggedBy || "—"}
              </p>
            </Card>
          ))}
        </ul>
      )}
    </Page>
  );
}
