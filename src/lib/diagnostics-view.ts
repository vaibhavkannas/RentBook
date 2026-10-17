import { parseYmKey } from "@/lib/domain/year-month";
import { formatMonthTitle, formatSavedAt } from "@/lib/format";
import type { Check } from "@/lib/setup-checks";
import type { TabKey } from "@/lib/sheets/named-tabs";
import type { SheetFacts } from "@/lib/sheets/sheet-checks";
import type { PillTone } from "@/lib/ui-classes";

/**
 * What Diagnostics says, as rows: how the app and the Sheet are doing, from the setup checks, the counts and times the
 * Sheet check gathered, and what this server has logged. Pure, so the words can be tested with every state of the Sheet;
 * the page only asks it and draws the answer. Nothing here is a setting's value or a person's data.
 */

export type DiagnosticsRow = {
  text: string;
  pill?: { tone: PillTone; label: string };
  link?: { href: string; label: string };
};

export type DiagnosticsSection = {
  id: "app" | "sheet" | "tabs" | "problems";
  title: string;
  rows: DiagnosticsRow[];
  /** A muted line under the rows. */
  note?: string;
};

export type DiagnosticsInput = {
  /** The app's version, as /api/health says it. */
  version: string;
  /** Every setup check: the environment's and the Sheet's. */
  checks: readonly Check[];
  /** Null when the Sheet could not be looked at. */
  facts: SheetFacts | null;
  /** What this server has logged since it started (see problemCounts in server/log.ts). */
  problems: { since: string; warn: Record<string, number>; error: Record<string, number> };
  /** What the owner called the app's own tabs; null when the settings cannot be read. */
  appTabNames: { settings: string; log: string; tenants: string } | null;
  /** The title each tab has in the Sheet, when it was listed. */
  realTitles: Partial<Record<TabKey, string | null>> | null;
  /** Where Set up is, with the month the person was looking at. */
  setupHref: string;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A time as the app shows one (India time), or the text as it is when it is not a time. */
const when = (iso: string) => formatSavedAt(iso);

const month = (key: string | null) => {
  const ym = key === null ? null : parseYmKey(key);
  return ym === null ? "" : formatMonthTitle(ym);
};

/** The most codes the Problems line names; the rest are counted. */
const MAX_CODES = 6;

function problemsLine(problems: DiagnosticsInput["problems"]): string {
  const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, count) => sum + count, 0);
  const errors = total(problems.error);
  const warnings = total(problems.warn);
  const since = when(problems.since);
  if (errors + warnings === 0) return `No problems logged since ${since}.`;
  const byCode = new Map<string, number>();
  for (const counts of [problems.warn, problems.error]) {
    for (const [code, count] of Object.entries(counts)) byCode.set(code, (byCode.get(code) ?? 0) + count);
  }
  const ordered = [...byCode].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
  const named = ordered.slice(0, MAX_CODES).map(([code, count]) => `${code} ${count}`);
  const more = ordered.length - named.length;
  const codes = `${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  return `Since ${since} on this server: ${plural(errors, "error", "errors")}, ${plural(warnings, "warning", "warnings")} (${codes}).`;
}

export function diagnosticsRows(input: DiagnosticsInput): DiagnosticsSection[] {
  const { checks, facts, problems } = input;
  const status = (id: string) => checks.find((check) => check.id === id)?.status ?? "skip";
  const okCount = checks.filter((check) => check.status === "ok").length;

  const app: DiagnosticsSection = {
    id: "app",
    title: "App",
    rows: [
      { text: `Version ${input.version}` },
      { text: `This server started ${when(problems.since)}` },
      { text: `Settings: ${okCount} of ${checks.length} OK`, link: { href: input.setupHref, label: "Open Set up" } },
    ],
  };

  const connection = checks.find((check) => check.id === "connection");
  const sheetRow: DiagnosticsRow =
    connection?.status === "ok" && facts !== null
      ? {
          text:
            facts.readMs === null
              ? `Answered in ${facts.listMs} ms (tab list).`
              : `Answered in ${facts.listMs} ms (tab list) and ${facts.readMs} ms (data).`,
          pill: { tone: "success", label: "Reachable" },
        }
      : connection?.status === "fail"
        ? { text: connection.detail, pill: { tone: "danger", label: "Not reachable" } }
        : {
            text: "The settings need fixing before the Sheet can be tried.",
            pill: { tone: "danger", label: "Not reachable" },
            link: { href: input.setupHref, label: "Open Set up" },
          };
  const sheet: DiagnosticsSection = { id: "sheet", title: "Google Sheet", rows: [sheetRow] };

  // The tabs. A tab's real title is shown where it is not the app's usual name for it.
  const reached = connection?.status === "ok" && facts !== null;
  const named = (label: string, key: TabKey) => {
    const real = input.realTitles?.[key];
    return typeof real === "string" && real !== label ? `${label} ("${real}")` : label;
  };
  const row = (label: string, key: TabKey, checkId: string, found: () => string): DiagnosticsRow => {
    const outcome = status(checkId);
    const text = !reached
      ? "not read"
      : outcome === "todo"
        ? "Not created yet"
        : outcome === "ok" || outcome === "warn"
          ? found()
          : "can't be read (see Set up)";
    return { text: `${named(label, key)}: ${text}` };
  };
  const scheduleRow: DiagnosticsRow = (() => {
    if (!reached) return { text: `${named("Schedule", "schedule")}: not read` };
    if (status("schedule-tab") === "fail") return { text: `${named("Schedule", "schedule")}: tab not found` };
    if (status("months") !== "ok" || facts.monthRows === null) {
      return { text: `${named("Schedule", "schedule")}: the month rows can't be read (see Set up)` };
    }
    return {
      text: `${named("Schedule", "schedule")}: ${plural(facts.monthRows, "month row", "month rows")}, ${month(facts.firstMonth)} to ${month(facts.lastMonth)}`,
    };
  })();
  const tabs: DiagnosticsSection = {
    id: "tabs",
    title: "Tabs",
    rows: [
      scheduleRow,
      row("Settings", "settings", "settings", () =>
        facts?.portionsOn == null ? "can't be read (see Set up)" : `${plural(facts.portionsOn, "portion", "portions")} on, ${facts.portionsOff ?? 0} switched off`,
      ),
      row("Payments Log", "log", "log", () => {
        const entries = facts?.logRows ?? 0;
        if (entries === 0) return "0 entries";
        return `${plural(entries, "entry", "entries")}, ${facts?.lastSavedAt ? `last saved ${when(facts.lastSavedAt)}` : "no saved time recorded"}`;
      }),
      row("Tenants", "tenants", "tenants", () =>
        facts?.tenantsRows == null ? "can't be read (see Set up)" : `${plural(facts.tenantsRows, "row", "rows")}, ${facts.openTenancies ?? 0} current`,
      ),
    ],
  };
  // A tab named by the owner that is not in the Sheet yet: the same warning as Set up gives.
  const VARIABLE = { settings: "SETTINGS_TAB", log: "LOG_TAB", tenants: "TENANTS_TAB" } as const;
  const USUAL = { settings: "Settings", log: "Payments Log", tenants: "Tenants" } as const;
  const missingNamed = (["settings", "log", "tenants"] as const).filter(
    (key) => status(key) === "todo" && input.appTabNames !== null && input.appTabNames[key] !== USUAL[key],
  );
  if (reached && missingNamed.length > 0) {
    const [first, ...rest] = missingNamed;
    const names = rest.length === 0 ? VARIABLE[first] : [first, ...rest].map((key) => VARIABLE[key]).join(" and ");
    tabs.note = `${names} ${rest.length === 0 ? "names a tab that is" : "name tabs that are"} not in your Sheet yet. If you already have ${rest.length === 0 ? "it" : "them"} under ${rest.length === 0 ? "another name" : "other names"}, rename ${rest.length === 0 ? "it" : "them"} in your Sheet first (see Set up).`;
  }

  const problemsSection: DiagnosticsSection = {
    id: "problems",
    title: "Problems",
    rows: [{ text: problemsLine(problems) }],
    note: "Each server instance counts on its own and starts from zero when it restarts.",
  };

  return [app, sheet, tabs, problemsSection];
}
