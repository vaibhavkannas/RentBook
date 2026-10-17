import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChipRow, type Chip } from "@/components/ui/ChipRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import {
  ACTIVITY_SCAN_LIMIT,
  ACTIVITY_SHOWN_LIMIT,
  activityHref,
  filterActivity,
  groupByDay,
  parseActivityFilters,
  portionsIn,
  toActivityEntry,
  type ActivityFilters,
  type ActivityShow,
} from "@/lib/activity-view";
import { monthParam } from "@/lib/app-nav";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readWrittenAt } from "@/lib/server/freshness";
import { problemMessage } from "@/lib/server/problem";
import { readActivity, type ActivityItem } from "@/lib/sheets/service";
import { cx } from "@/lib/ui-classes";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** The first row of chips: which kind of entry. The words are the pill's, so a chip names what a card says. */
const SHOW_CHIPS: readonly { show: ActivityShow; label: string }[] = [
  { show: "all", label: "All" },
  { show: "logged", label: "Logged" },
  { show: "edited", label: "Changed" },
  { show: "undone", label: "Undone" },
];

const EVERYTHING: ActivityFilters = { show: "all", portion: null };

/** The two rows of chips: each leads to this screen with that choice made and the other choice kept. */
function filterRows(filters: ActivityFilters, portions: string[], month: string | null): { show: Chip[]; portion: Chip[] } {
  return {
    show: SHOW_CHIPS.map(({ show, label }) => ({
      label,
      href: activityHref({ ...filters, show }, month),
      selected: filters.show === show,
    })),
    portion: [
      { label: "All portions", href: activityHref({ ...filters, portion: null }, month), selected: filters.portion === null },
      ...portions.map((portion) => ({
        label: portion,
        href: activityHref({ ...filters, portion }, month),
        selected: filters.portion === portion,
      })),
    ],
  };
}

/** The entries of one day: a heading that stays under the notch while the day scrolls, and a card for each entry. */
function Day({ dayKey, heading, items, viewerEmail }: { dayKey: string; heading: string; items: ActivityItem[]; viewerEmail: string }) {
  const headingId = `day-${dayKey}`;
  return (
    <section aria-labelledby={headingId} className="mt-2">
      <h2 id={headingId} className="sticky top-safe z-10 bg-background py-2 text-sm font-medium text-muted">
        {heading}
      </h2>
      <ol className="space-y-3">
        {items.map((item, index) => {
          const entry = toActivityEntry(item, viewerEmail);
          return (
            <Card as="li" key={`${item.savedAt}-${index}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words font-medium">{entry.portion}</p>
                <Pill tone={entry.tone}>{entry.label}</Pill>
              </div>
              <p className="mt-1 break-words text-sm">{entry.summary}</p>
              {entry.amount !== null && (
                <p className={cx("mt-1 text-lg font-medium", entry.struck && "text-muted line-through")}>
                  {entry.struck && <span className="sr-only">removed </span>}
                  {entry.amount}
                </p>
              )}
              <p className="mt-1 break-words text-sm text-muted">{entry.meta}</p>
            </Card>
          );
        })}
      </ol>
    </section>
  );
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  const params = await searchParams;
  // The month the person was looking at: the chips and Try again keep it, so the tab bar and the way back still lead to it.
  const month = monthParam(params?.month);
  const filters = parseActivityFilters(params);

  let items: ActivityItem[] | null = null;
  let problem: string | null = null;
  try {
    items = await readActivity(getSheetsContext(), ACTIVITY_SCAN_LIMIT, { minFetchedAt: await readWrittenAt(viewer.email) });
  } catch (error) {
    problem = problemMessage(error, viewer);
  }

  const matching = items ? filterActivity(items, filters) : [];
  const days = groupByDay(matching.slice(0, ACTIVITY_SHOWN_LIMIT), new Date());
  const rows = items && items.length > 0 ? filterRows(filters, portionsIn(items), month) : null;

  return (
    <Page>
      <PageHeader title="Activity" />

      {problem && <LoadProblem message={problem} retryHref={activityHref(filters, month)} />}

      {items && items.length === 0 && (
        <EmptyState title="Nothing logged yet">Payments you log, change or undo show up here, newest first.</EmptyState>
      )}

      {rows && (
        <div className="mt-1">
          <ChipRow label="Show" chips={rows.show} />
          <ChipRow label="Portion" chips={rows.portion} />
        </div>
      )}

      {rows && matching.length === 0 && (
        <EmptyState
          title="No entries match these filters."
          action={
            <ButtonLink href={activityHref(EVERYTHING, month)} replace scroll={false} variant="secondary">
              Show everything
            </ButtonLink>
          }
        />
      )}

      {days.map((day) => (
        <Day key={day.key} dayKey={day.key} heading={day.heading} items={day.entries} viewerEmail={viewer.email} />
      ))}

      {matching.length > ACTIVITY_SHOWN_LIMIT && (
        <p className="mt-4 text-center text-sm text-muted">
          {`Showing the newest ${ACTIVITY_SHOWN_LIMIT}. Older entries are in the Payments Log tab of your Sheet.`}
        </p>
      )}
    </Page>
  );
}
