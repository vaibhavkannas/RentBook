import Link from "next/link";
import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { monthParam, yearHref } from "@/lib/app-nav";
import { currentYm, monthName, parseYmKey, todayIso, ymKey } from "@/lib/domain/year-month";
import { deriveYearView, parseYear, yearBounds, yearNeighbours, type YearCell, type YearRow, type YearView } from "@/lib/domain/year-view";
import { formatRupees } from "@/lib/format";
import { monthHref } from "@/lib/month-nav";
import { progressPercent } from "@/lib/rent-difference";
import {
  YEAR_LEGEND,
  YEAR_TENANTS_PROBLEM_NOTICE,
  yearCellLabel,
  yearEmptyText,
  yearEmptyTitle,
} from "@/lib/report-copy";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { loadPageSnapshot } from "@/lib/server/freshness";
import { problemMessage, setupHrefFor } from "@/lib/server/problem";
import type { Snapshot } from "@/lib/sheets/service";
import { cx, ICON_BUTTON_OFF, iconButtonClasses, yearCellClasses } from "@/lib/ui-classes";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** What a month is drawn with besides its colours: a 44 px square, the short month name over the glyph. */
const CELL = "flex min-h-11 flex-col items-center justify-center rounded-chip text-xs font-medium";

/** The glyph of each state, from the key, so a cell and the key can never disagree. A month with no record is a dash. */
const GLYPH = { ...Object.fromEntries(YEAR_LEGEND.map(({ state, glyph }) => [state, glyph])), none: "—" } as Record<YearCell["state"], string>;

/** One month of one portion: a link to that month, or, before the Schedule, a muted dash that leads nowhere. */
function Month({ cell, portionName, currentKey }: { cell: YearCell; portionName: string; currentKey: string }) {
  const label = yearCellLabel(cell, portionName);
  const short = monthName(cell.month.month, false);
  const glyph = <span aria-hidden="true" className="text-base leading-none">{GLYPH[cell.state]}</span>;
  if (cell.state === "none") {
    return (
      <li>
        <span className={cx(CELL, yearCellClasses("none"))}>
          <span aria-hidden="true">{short}</span>
          {glyph}
          <span className="sr-only">{label}</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <Link href={monthHref(ymKey(cell.month), currentKey)} aria-label={label} className={cx("press", CELL, yearCellClasses(cell.state))}>
        <span>{short}</span>
        {glyph}
      </Link>
    </li>
  );
}

function Portion({ row, year, currentKey }: { row: YearRow; year: number; currentKey: string }) {
  return (
    <Card as="li">
      <h2 className="font-medium">{row.name}</h2>
      <p className="mt-0.5 text-sm text-muted">
        {formatRupees(row.received)} of {formatRupees(row.due)}
      </p>
      <ol aria-label={`Months of ${year}, ${row.name}`} className="mt-2 grid grid-cols-6 gap-1.5">
        {row.cells.map((cell) => (
          <Month key={ymKey(cell.month)} cell={cell} portionName={row.name} currentKey={currentKey} />
        ))}
      </ol>
    </Card>
  );
}

/** The year between two arrows. An arrow with nowhere to go is a dimmed span of the same size, so the row does not move. */
function Switcher({ year, monthKey, bounds }: { year: number; monthKey: string | null; bounds: { first: number; last: number } }) {
  const { previous, next } = yearNeighbours(year, bounds);
  const arrow = (target: number | null, label: string, glyph: string) =>
    target === null ? (
      <span role="link" aria-disabled="true" aria-label={label} className={ICON_BUTTON_OFF}>
        {glyph}
      </span>
    ) : (
      // Replacing, as the month screen does: a walk through the years must not fill the history.
      <Link href={yearHref(target, monthKey)} replace scroll={false} aria-label={label} className={iconButtonClasses()}>
        {glyph}
      </Link>
    );
  return (
    <nav aria-label="Year" className="mt-3 flex items-center justify-between">
      {arrow(previous, "Previous year", "‹")}
      <h2 className="text-lg font-semibold">{year}</h2>
      {arrow(next, "Next year", "›")}
    </nav>
  );
}

function Summary({ view }: { view: YearView }) {
  return (
    <Card as="section" aria-label={`Received in ${view.year}`} className="mt-3">
      <p className="text-sm text-muted">Received</p>
      <p className="mt-0.5 text-2xl font-semibold">
        {formatRupees(view.received)} <span className="text-sm font-normal text-muted">of {formatRupees(view.due)}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
        <div className="h-full bg-accent" style={{ width: `${progressPercent(view.received, view.due)}%` }} />
      </div>
    </Card>
  );
}

/** What each glyph means: a glyph and a word beside the colour it is drawn in. */
function Key() {
  return (
    <ul aria-label="Key" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {YEAR_LEGEND.map(({ state, glyph, label }) => (
        <li key={state} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cx("inline-grid size-6 place-items-center rounded-chip text-xs", yearCellClasses(state))}>
            {glyph}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}

export default async function YearPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  const params = await searchParams;
  // The month the person was looking at: the arrows, Try again and the arrow back keep it.
  const monthKey = monthParam(params?.month);

  const now = new Date();
  const today = todayIso(now);
  const currentKey = ymKey(currentYm(now));
  // The year in the address, else the year of the month that was showing, else this year.
  const year = parseYear(params?.year) ?? (monthKey ? parseYmKey(monthKey)!.year : currentYm(now).year);

  let snapshot: Snapshot | null = null;
  let problem: string | null = null;
  let setupHref: string | undefined;
  try {
    snapshot = await loadPageSnapshot(getSheetsContext(), viewer.email);
  } catch (error) {
    problem = problemMessage(error, viewer);
    setupHref = setupHrefFor(error, viewer, monthKey);
  }

  const view = snapshot ? deriveYearView(snapshot, year, today) : null;

  return (
    <Page>
      <PageHeader title="Year at a glance" back={{ href: "/", label: "Back to month" }} />

      {problem && <LoadProblem message={problem} retryHref={yearHref(year, monthKey)} setupHref={setupHref} />}

      {snapshot && view && (
        <>
          {snapshot.tenantsProblem !== undefined && (
            <Notice tone="warn" className="mt-3">
              {YEAR_TENANTS_PROBLEM_NOTICE(snapshot.tenantsProblem)}
            </Notice>
          )}

          <Switcher year={year} monthKey={monthKey} bounds={yearBounds(snapshot.rows, today)} />

          {view.hasData ? (
            <>
              <Summary view={view} />
              <Key />
              <ul className="mt-3 space-y-3">
                {view.rows.map((row) => (
                  <Portion key={row.portionId} row={row} year={year} currentKey={currentKey} />
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              title={yearEmptyTitle(year)}
              action={
                view.firstMonth !== null && view.firstMonth.year !== year ? (
                  <ButtonLink href={yearHref(view.firstMonth.year, monthKey)} variant="secondary">
                    Show {view.firstMonth.year}
                  </ButtonLink>
                ) : undefined
              }
            >
              {yearEmptyText(view.firstMonth)}
            </EmptyState>
          )}
        </>
      )}
    </Page>
  );
}
