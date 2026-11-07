import { whoText } from "@/lib/activity-view";
import { formatDay, formatRupees, formatSavedAt, indiaDayKey } from "@/lib/format";
import { isValidIsoDay } from "@/lib/domain/year-month";
import type { TenancyLogItem } from "@/lib/sheets/tenancy-log-store";

/**
 * What the History section of the tenant page says about the Tenancy Log: one entry for each save, in plain words. It only
 * words rows the log already holds (see src/lib/domain/tenancy-log.ts for what a row is), so it can be tested with odd and
 * hand-edited rows; the page reads the log, asks these functions and draws the answers.
 */

/** How many entries the section shows, newest first. The log is read whole either way, so only what is drawn is limited. */
export const HISTORY_SHOWN_LIMIT = 30;

/** What a tenancy is called when the page has no name for its id (a tenancy that is no longer in the Tenants tab). */
export const PAST_TENANT = "a past tenant";

export const HISTORY_EMPTY_TITLE = "No changes recorded yet.";
export const HISTORY_EMPTY_HINT =
  "Changes saved in the app from now on are listed here, newest first. Changes made straight in the Sheet are not.";

/** Said under a list that has been cut at HISTORY_SHOWN_LIMIT. */
export const historyOverLimitNote = () =>
  `Showing the newest ${HISTORY_SHOWN_LIMIT} changes. Older ones are in the Tenancy Log tab of your Sheet.`;

/** Said in place of the list when the log cannot be read or its headers are wrong; `reason` says why. */
export const historyProblemNotice = (reason: string) => `The history can't be shown right now. ${reason}`;

export type HistoryEntry = {
  /** What was done and for whom: "Details changed for Asha." */
  title: string;
  /** One line for each field the save changed. */
  lines: string[];
  /** When and by whom: "3 Nov, 3:00 pm · by you". */
  meta: string;
};

export type HistoryList = {
  /** The newest entries, newest first, at most HISTORY_SHOWN_LIMIT. */
  entries: HistoryEntry[];
  /** How many older entries are not shown. */
  older: number;
};

/** The first letter in capitals, for a sentence that opens with "a past tenant". */
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const AMOUNT_FIELDS: readonly string[] = ["Advance", "Refund", "Deductions"];

/** A value as the line shows it: an amount in rupees, a real day as a date, anything else as it is. */
function shown(field: string, value: string | number): string {
  if (typeof value === "number") return AMOUNT_FIELDS.includes(field) ? formatRupees(value) : String(value);
  return formatDay(value);
}

/**
 * The line for one changed field. A phone number and a note are never said, only that they changed (the log does not hold
 * them, and a hand-edited row that does is not repeated here).
 */
function fieldLine({ field, oldValue, newValue }: TenancyLogItem): string {
  if (field === "") return "Change recorded.";
  if (field === "Phone") return "Phone number changed.";
  if (field === "Notes") return "Notes changed.";
  const was = oldValue === "" ? null : shown(field, oldValue);
  const now = newValue === "" ? null : shown(field, newValue);
  if (was === null && now === null) return `${field} changed.`;
  if (was === null) return `${field} set to ${now}.`;
  if (now === null) return `${field} removed (was ${was}).`;
  return `${field} changed from ${was} to ${now}.`;
}

/** The rows of a save, in the order they were written. The log is given newest first, so a save's rows come last row first. */
function inWrittenOrder(items: readonly TenancyLogItem[]): TenancyLogItem[] {
  const rows: TenancyLogItem[] = [];
  for (let start = 0; start < items.length; ) {
    let end = start + 1;
    while (end < items.length && items[end].savedAt === items[start].savedAt) end += 1;
    rows.push(...items.slice(start, end).reverse());
    start = end;
  }
  return rows;
}

/** Neighbouring rows of one save, one tenancy and one action make one entry. A row with an action this version does not know stands alone. */
function groupRows(rows: readonly TenancyLogItem[]): TenancyLogItem[][] {
  const groups: TenancyLogItem[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const joins =
      last !== undefined &&
      row.action !== null &&
      last[0].action === row.action &&
      last[0].savedAt === row.savedAt &&
      last[0].tenancyId === row.tenancyId;
    if (joins) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

/** The day a move-out or a closing row names, or null when it names none. */
function moveOutDay(rows: readonly TenancyLogItem[]): { row: TenancyLogItem; day: string } | null {
  const row = rows.find((candidate) => candidate.field === "Move-out date" && typeof candidate.newValue === "string" && isValidIsoDay(candidate.newValue));
  return row === undefined ? null : { row, day: row.newValue as string };
}

function toEntry(rows: readonly TenancyLogItem[], names: ReadonlyMap<string, string>, viewerEmail: string | null | undefined): HistoryEntry {
  const [first] = rows;
  const when = indiaDayKey(first.savedAt) === null ? "Time not recorded" : formatSavedAt(first.savedAt);
  const meta = `${when} · ${whoText(first.changedBy, viewerEmail)}`;
  if (first.action === null) {
    return { title: first.field === "" ? "Change recorded." : `Change recorded: ${first.field}.`, lines: [], meta };
  }

  const tenant = names.get(first.tenancyId)?.trim() || PAST_TENANT;
  const moved = first.action === "Moved out" || first.action === "Closed" ? moveOutDay(rows) : null;
  let title: string;
  switch (first.action) {
    case "Added":
      title = `Details added for ${tenant}.`;
      break;
    case "Edited":
      title = `Details changed for ${tenant}.`;
      break;
    case "Moved out":
      title = sentence(moved ? `${tenant} moved out on ${formatDay(moved.day)}.` : `${tenant} moved out.`);
      break;
    case "Closed":
      title = sentence(
        `${tenant}'s tenancy was closed${moved ? ` on ${formatDay(moved.day)}` : ""}, when the next tenant was added.`,
      );
      break;
  }
  // The title says what an Added row means and the day of a move-out or a closing; every other row is a line.
  const lines = first.action === "Added" ? [] : rows.filter((row) => row !== moved?.row).map(fieldLine);
  return { title, lines, meta };
}

/**
 * The History of one portion: `items` are its rows of the Tenancy Log, newest first (see readTenancyHistory); `names` says
 * who each tenancy id was (the page's tenancies), `viewerEmail` is the signed-in person ("by you"). One entry for each save,
 * newest first; the rows of a save keep the order they were written in, so an Added entry comes before the Closed one it ended.
 * Phone and Notes are only ever said to have changed.
 */
export function historyEntries(
  items: readonly TenancyLogItem[],
  names: ReadonlyMap<string, string>,
  viewerEmail: string | null | undefined,
): HistoryList {
  const groups = groupRows(inWrittenOrder(items));
  return {
    entries: groups.slice(0, HISTORY_SHOWN_LIMIT).map((rows) => toEntry(rows, names, viewerEmail)),
    older: Math.max(0, groups.length - HISTORY_SHOWN_LIMIT),
  };
}
