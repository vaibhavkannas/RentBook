import Link from "next/link";
import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { monthParam, withMonth } from "@/lib/app-nav";
import { overdueList, overdueTotals, type OverdueItem } from "@/lib/domain/overdue";
import { lastDueMonth } from "@/lib/domain/rent-due";
import type { YearMonth } from "@/lib/domain/types";
import { currentYm, todayIso, ymKey } from "@/lib/domain/year-month";
import { formatMonthTitle, formatRupees } from "@/lib/format";
import { monthHref } from "@/lib/month-nav";
import {
  earlierMonthsText,
  MOVED_OUT_HINT,
  nothingOverdueText,
  OVERDUE_RULES,
  overdueAge,
  overdueCountLine,
  overdueMonthLine,
  overdueMonthsShown,
  overdueSummary,
  showMovedOutHint,
  TENANTS_PROBLEM_NOTICE,
} from "@/lib/report-copy";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { loadPageSnapshot } from "@/lib/server/freshness";
import { problemMessage, setupHrefFor } from "@/lib/server/problem";
import type { Snapshot } from "@/lib/sheets/service";
import { tenantsPagePath } from "@/lib/tenancy-response";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** One portion that owes: what, who, since when, and each month as a link to that month's screen. */
function Owes({ item, monthKey, currentKey, thisMonth }: { item: OverdueItem; monthKey: string | null; currentKey: string; thisMonth: YearMonth }) {
  const { shown, earlier } = overdueMonthsShown(item.months);
  return (
    <Card as="li">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-words font-medium">{item.name}</h2>
        <Pill tone="danger">{formatRupees(item.owed)}</Pill>
      </div>
      <p className="mt-1 break-words text-sm">{overdueSummary(item)}</p>
      <p className="mt-0.5 text-sm text-muted">
        Oldest: {formatMonthTitle(item.oldest)}, {overdueAge(item.daysOverdue)}
      </p>

      <ol aria-label={`Months ${item.name} owes rent for`} className="mt-2 divide-y divide-line">
        {shown.map((owed) => (
          <li key={ymKey(owed.month)}>
            <Link href={monthHref(ymKey(owed.month), currentKey)} className="press flex min-h-11 items-center justify-between gap-3 py-1">
              <span className="min-w-0">
                <span className="block font-medium">{formatMonthTitle(owed.month)}</span>
                <span className="block break-words text-sm text-muted">{overdueMonthLine(owed)}</span>
              </span>
              <span aria-hidden="true" className="text-xl text-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {earlier > 0 && <p className="mt-1 text-sm text-muted">{earlierMonthsText(earlier)}</p>}

      {showMovedOutHint(item.oldest, thisMonth) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3">
          <p className="min-w-0 flex-1 text-sm text-muted">{MOVED_OUT_HINT}</p>
          <Link
            href={tenantsPagePath(item.portionId, monthKey)}
            aria-label={`Tenant page for ${item.name}`}
            className="press inline-flex min-h-11 min-w-11 items-center text-sm text-muted underline"
          >
            Tenant page
          </Link>
        </div>
      )}
    </Card>
  );
}

/** How the figures are worked out, closed until asked for. The words are built from the constants the rule uses. */
function Rules() {
  return (
    <Card as="section" className="mt-4">
      <details className="group">
        <summary className="press flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
          How this is worked out
          <span aria-hidden="true" className="text-xl text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none">
            ›
          </span>
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
          {OVERDUE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export default async function OverduePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  // The month the person was looking at: Try again, the links to a tenant page and the arrow back keep it.
  const monthKey = monthParam((await searchParams)?.month);

  const now = new Date();
  const thisMonth = currentYm(now);
  const currentKey = ymKey(thisMonth);

  let snapshot: Snapshot | null = null;
  let problem: string | null = null;
  let setupHref: string | undefined;
  try {
    snapshot = await loadPageSnapshot(getSheetsContext(), viewer.email);
  } catch (error) {
    problem = problemMessage(error, viewer);
    setupHref = setupHrefFor(error, viewer, monthKey);
  }

  const items = snapshot ? overdueList(snapshot, todayIso(now)) : [];
  const totals = overdueTotals(items);
  const upTo = lastDueMonth(todayIso(now));

  return (
    <Page>
      <PageHeader title="Overdue rent" back={{ href: "/", label: "Back to month" }} />

      {problem && <LoadProblem message={problem} retryHref={withMonth("/overdue", monthKey)} setupHref={setupHref} />}

      {snapshot && (
        <>
          {snapshot.tenantsProblem !== undefined && (
            <Notice tone="warn" className="mt-3">
              {TENANTS_PROBLEM_NOTICE(snapshot.tenantsProblem)}
            </Notice>
          )}

          {items.length === 0 ? (
            <EmptyState
              title="Nothing overdue"
              action={
                <ButtonLink href={monthKey ? monthHref(monthKey, currentKey) : "/"} variant="secondary">
                  Back to the month
                </ButtonLink>
              }
            >
              {nothingOverdueText(upTo)}
            </EmptyState>
          ) : (
            <>
              <Card as="section" aria-label="Overdue summary" className="mt-3">
                <p className="text-2xl font-semibold">{formatRupees(totals.owed)} overdue</p>
                <p className="mt-0.5 text-sm text-muted">{overdueCountLine(totals.portions, upTo)}</p>
              </Card>

              <ul className="mt-3 space-y-3">
                {items.map((item) => (
                  <Owes key={item.portionId} item={item} monthKey={monthKey} currentKey={currentKey} thisMonth={thisMonth} />
                ))}
              </ul>
            </>
          )}

          <Rules />
        </>
      )}
    </Page>
  );
}
