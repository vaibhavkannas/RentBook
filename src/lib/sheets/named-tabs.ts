import { AppError, configError } from "@/lib/errors";
import type { CellWrite, RangeRequest, RowOverride, SheetsGateway, TabNaming, ValueRender } from "./gateway";
import { headerKey } from "./headers";
import { LOG_TAB, resetBootstrap, SETTINGS_TAB } from "./settings-store";
import { TENANTS_TAB } from "./tenants-store";

/** The four tabs the app works with: the owner's Schedule, and its own Settings, Payments Log and Tenants. */
export type TabKey = "schedule" | "settings" | "log" | "tenants";

/** The name each of the four tabs has in the owner's Sheet (SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB, TENANTS_TAB). */
export type TabNames = Record<TabKey, string>;

/** What the three app tabs are called when the owner does not say otherwise: the names the rest of the app uses for them. */
export const DEFAULT_TAB_NAMES: Omit<TabNames, "schedule"> = {
  settings: SETTINGS_TAB,
  log: LOG_TAB,
  tenants: TENANTS_TAB,
};

const APP_TABS = ["settings", "log", "tenants"] as const;

/**
 * What is wrong with the four tab names, in words, or null. Each must name a different tab (compared with
 * `headerKey`), and the Schedule may not be named like one of the app's own tabs that has been given another
 * name: the app calls that tab by its own name inside, so the two could not be told apart.
 */
export function tabNamesProblem(names: TabNames): string | null {
  const keys = (["schedule", ...APP_TABS] as const).map((key) => headerKey(names[key]));
  if (new Set(keys).size !== keys.length) {
    return "SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB and TENANTS_TAB must each name a different tab.";
  }
  for (const key of APP_TABS) {
    if (headerKey(names.schedule) === headerKey(DEFAULT_TAB_NAMES[key])) {
      return `SCHEDULE_TAB can't be "${DEFAULT_TAB_NAMES[key]}": the app keeps that name for its own tab, even when it is stored under another name. Give your Schedule tab a different name and set SCHEDULE_TAB to it.`;
    }
  }
  return null;
}

/** `logical` is the name the rest of the app uses for a tab, `configured` the name the owner asked for. */
type Entry = { key: TabKey; logical: string; configured: string };

/**
 * Sits between the app and the Google gateway so that the app keeps calling its tabs by one fixed name each, while
 * the owner's Sheet may spell them differently or call the app's own tabs something else.
 *
 * - The real tab for a configured name is the tab whose title equals it, else the single tab whose title is the
 *   same by `headerKey` (any case or spacing), else none. Two look-alikes count as none: it never guesses.
 * - `listTabs` answers with the app's name for each tab it found, and leaves out any other tab whose title is one
 *   of those names, so the owner's own "Tenants" tab is never taken for the app's when TENANTS_TAB points elsewhere.
 * - Every other method turns the app's name into the real title. A tab it did not find is called by its configured
 *   name, so Google's "not found" names the tab the owner has to create or rename. Names it does not know pass through.
 * - `addTab` creates the tab under its configured name.
 *
 * What it found is remembered. The list comes from `listTabs`, which the app's tab check calls first, so the wrapper
 * asks Google for nothing the app was not asking for anyway, and with the default names it makes exactly the calls
 * the bare gateway would. It forgets what it knew when Google says a tab is gone (a "tab missing" error carries the
 * tab in its details) and then resets the app's tab check for itself, which the Google gateway cannot: that check is
 * remembered per gateway, and the app holds this one.
 */
export class NamedTabsGateway implements SheetsGateway, TabNaming {
  private readonly entries: Entry[];
  /** The real title of each tab found, by the app's name for it; null until the Sheet's tabs have been listed. */
  private found: Map<string, string> | null = null;

  constructor(
    private readonly inner: SheetsGateway,
    names: TabNames,
  ) {
    const problem = tabNamesProblem(names);
    if (problem !== null) throw configError(problem);
    this.entries = [
      { key: "schedule", logical: names.schedule, configured: names.schedule },
      ...APP_TABS.map((key) => ({ key, logical: DEFAULT_TAB_NAMES[key], configured: names[key] })),
    ];
  }

  /** Which real tab goes with each name, from the titles Google listed. */
  private resolve(titles: string[]): Map<string, string> {
    const found = new Map<string, string>();
    for (const { logical, configured } of this.entries) {
      const same = titles.filter((title) => headerKey(title) === headerKey(configured));
      const real = titles.includes(configured) ? configured : same.length === 1 ? same[0] : undefined;
      if (real !== undefined) found.set(logical, real);
    }
    this.found = found;
    return found;
  }

  /** A function that turns the app's name for a tab into its real title; Google is asked only when a name needs it. */
  private async translator(tabs: string[]): Promise<(tab: string) => string> {
    const isApp = (tab: string) => this.entries.some((entry) => entry.logical === tab);
    if (!tabs.some(isApp)) return (tab) => tab;
    const found = this.found ?? this.resolve(await this.run(() => this.inner.listTabs()));
    return (tab) =>
      found.get(tab) ?? this.entries.find((entry) => entry.logical === tab)?.configured ?? tab;
  }

  /** Runs a call to Google. A "tab missing" error makes the wrapper forget its list and the app check its tabs again. */
  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AppError && typeof error.details?.tab === "string") {
        this.found = null;
        resetBootstrap(this);
      }
      throw error;
    }
  }

  async listTabs(): Promise<string[]> {
    const titles = await this.run(() => this.inner.listTabs());
    const found = this.resolve(titles);
    const appName = new Map([...found].map(([logical, real]) => [real, logical]));
    const appNames = new Set(this.entries.map((entry) => entry.logical));
    return titles.flatMap((title) => {
      const logical = appName.get(title);
      if (logical !== undefined) return [logical];
      return appNames.has(title) ? [] : [title];
    });
  }

  /** What the owner called the tab the app knows as `appName`: its configured name, or `appName` itself for a name the wrapper does not know. */
  configuredTabName(appName: string): string {
    return this.entries.find((entry) => entry.logical === appName)?.configured ?? appName;
  }

  /** The real title of each of the four tabs in what has been found, or null for one that was not found. */
  private titlesIn(found: Map<string, string>): Record<TabKey, string | null> {
    const titles = {} as Record<TabKey, string | null>;
    for (const { key, logical } of this.entries) titles[key] = found.get(logical) ?? null;
    return titles;
  }

  /** The real title of each of the four tabs, or null for one that was not found. Always read from the Sheet. */
  async realTitles(): Promise<Record<TabKey, string | null>> {
    return this.titlesIn(this.resolve(await this.run(() => this.inner.listTabs())));
  }

  /**
   * The same, from the last time the tabs were listed, without asking Google: null when they have not been listed yet,
   * or the wrapper has forgotten them (Google said a tab is gone). For a check that lists the tabs itself and then wants
   * their titles, so it costs no call of its own.
   */
  knownTitles(): Record<TabKey, string | null> | null {
    return this.found === null ? null : this.titlesIn(this.found);
  }

  async addTab(title: string): Promise<void> {
    const entry = this.entries.find((candidate) => candidate.logical === title);
    const real = entry?.configured ?? title;
    await this.run(() => this.inner.addTab(real));
    // Google makes the tab with the title it was given, so the tab can be named without asking the Sheet again.
    if (entry) this.found?.set(entry.logical, real);
  }

  async getValues(tab: string, a1: string, render: ValueRender): Promise<unknown[][]> {
    const real = await this.translator([tab]);
    return this.run(() => this.inner.getValues(real(tab), a1, render));
  }

  async getManyValues(requests: RangeRequest[], render: ValueRender): Promise<unknown[][][]> {
    const real = await this.translator(requests.map(({ tab }) => tab));
    return this.run(() =>
      this.inner.getManyValues(requests.map(({ tab, a1 }) => ({ tab: real(tab), a1 })), render),
    );
  }

  async updateValues(writes: CellWrite[]): Promise<void> {
    const real = await this.translator(writes.map(({ tab }) => tab));
    await this.run(() => this.inner.updateValues(writes.map((write) => ({ ...write, tab: real(write.tab) }))));
  }

  async appendRow(tab: string, row: unknown[]): Promise<void> {
    const real = await this.translator([tab]);
    await this.run(() => this.inner.appendRow(real(tab), row));
  }

  async cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ): Promise<void> {
    const real = await this.translator([tab]);
    await this.run(() => this.inner.cloneRow(real(tab), fromRow, toRow, clearCols, overrides));
  }
}
