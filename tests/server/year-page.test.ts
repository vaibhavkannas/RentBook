import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import type { ScheduleRow } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";
import { formatRupees } from "@/lib/format";
import { YEAR_LEGEND } from "@/lib/report-copy";
import type { YearCellState } from "@/lib/domain/year-view";
import { buttonClasses, CARD, ICON_BUTTON_OFF, noticeClasses, yearCellClasses } from "@/lib/ui-classes";
import { smallTargets, unpressedTargets } from "../support/tap-targets";
import { baseRows, parsedRows, PORTIONS } from "../support/fixtures";

// The Year screen: each portion's twelve months, from the same snapshot and cards as the month screen, with the data layer
// replaced. The arrow back is a client component; here it renders its first (server) output only.

const nav = vi.hoisted(() => ({ search: "" }));

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  loadPageSnapshot: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/year",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ loadPageSnapshot: mocks.loadPageSnapshot }));

import YearPage from "@/app/year/page";

/** 17 October 2026, noon in India: this month is October and September is the last that has fallen due. */
const NOW = new Date("2026-10-17T06:30:00Z");

type SnapshotOptions = { rows?: ScheduleRow[]; tenancies?: Tenancy[]; tenantsProblem?: string };

const snapshot = ({ rows = baseRows(), tenancies = [], tenantsProblem }: SnapshotOptions = {}) => ({
  portions: PORTIONS,
  rows,
  tenancies,
  tenantsProblem,
});

async function render(searchParams: Record<string, string | string[] | undefined> = {}): Promise<string> {
  const page = (await YearPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

/** The text a person reads, without the markup. */
const visibleText = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();

/** The cards of the portions, in the order the page draws them. */
const portionCards = (html: string) => html.split(`<li class="${CARD}">`).slice(1).map((part) => part.split("</ol></li>")[0]);

/** The twelve cells of one portion's card. */
const cellsOf = (card: string) => {
  const list = card.slice(card.indexOf("<ol "));
  return list.slice(list.indexOf(">") + 1).split("<li>").slice(1);
};

const headingsIn = (html: string) => [...html.matchAll(/<h2 class="break-words font-semibold leading-tight">([^<]*)<\/h2>/g)].map((match) => match[1]);

/** A Schedule of 2025 and 2026: every portion is let in both years. */
const twoYears = () =>
  parsedRows(
    [2025, 11, [["Asha", 1, 5450], ["Bala", 1, 12700]]],
    [2025, 12, [["Asha", 2, 5450], ["Bala", 2, 12700]]],
    [2026, 1, [["Asha", 3, 5450], ["Bala", 3, 12700]]],
  );

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.loadPageSnapshot.mockResolvedValue(snapshot());
});
afterEach(() => vi.useRealTimers());

describe("the Year page", () => {
  it("sends a person who is not signed in to the sign-in page, before it reads the Sheet", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
    expect(mocks.loadPageSnapshot).not.toHaveBeenCalled();
  });

  it("reads the snapshot for the signed-in person, so it is never older than their own last change", async () => {
    await render();
    expect(mocks.loadPageSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.loadPageSnapshot).toHaveBeenCalledWith(expect.anything(), "member@example.com");
  });

  it("is titled Year at a glance, with an arrow back to the month that was showing", async () => {
    nav.search = "month=2026-08";
    const html = await render({ month: "2026-08" });
    expect(html).toContain('<h1 class="min-w-0 break-words font-display text-xl font-bold leading-tight">Year at a glance</h1>');
    expect(html).toMatch(/<a [^>]*aria-label="Back to month"[^>]*href="\/\?month=2026-08"[^>]*><svg[^>]*>[\s\S]*?<\/svg><\/a>/);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("makes room for the tab bar", async () => {
    expect(await render()).toMatch(/^<main class="[^"]*\bpb-tabbar\b/);
  });
});

describe("which year the page shows", () => {
  const shown = (html: string) => /<nav aria-label="Year"[^>]*>[\s\S]*?<h2 [^>]*>(\d{4})<\/h2>/.exec(html)?.[1];

  beforeEach(() => mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: twoYears() })));

  it("is the year in the address", async () => {
    expect(shown(await render({ year: "2025" }))).toBe("2025");
  });

  it("is the year of the month in the address when there is no year", async () => {
    expect(shown(await render({ month: "2025-12" }))).toBe("2025");
  });

  it("goes by the year, not the month, when both are there", async () => {
    expect(shown(await render({ year: "2026", month: "2025-12" }))).toBe("2026");
  });

  it("is this year when the address names neither", async () => {
    expect(shown(await render())).toBe("2026");
  });

  it("falls back to the month, and then to this year, for a year that is not a year", async () => {
    expect(shown(await render({ year: "abcd", month: "2025-03" }))).toBe("2025");
    expect(shown(await render({ year: "1999" }))).toBe("2026");
    expect(shown(await render({ year: "20266" }))).toBe("2026");
    expect(shown(await render({ year: ["2025", "2026"] }))).toBe("2025");
  });
});

describe("the year switcher", () => {
  const arrows = (html: string) => /<nav aria-label="Year"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";

  it("has no way to another year when the Schedule is of one year: both arrows are dimmed and say they are not available", async () => {
    const nav = arrows(await render({ month: "2026-10" }));
    expect(nav).toContain(`<span role="link" aria-disabled="true" aria-label="Previous year" class="${ICON_BUTTON_OFF}"><svg`);
    expect(nav).toContain(`<span role="link" aria-disabled="true" aria-label="Next year" class="${ICON_BUTTON_OFF}"><svg`);
    expect(nav).not.toContain("<a ");
  });

  it("puts the year between the arrows, as a heading", async () => {
    const nav = arrows(await render());
    expect(nav.indexOf("Previous year")).toBeLessThan(nav.indexOf("<h2"));
    expect(nav.indexOf("<h2")).toBeLessThan(nav.indexOf("Next year"));
  });

  describe("with two years of Schedule", () => {
    beforeEach(() => mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: twoYears() })));

    it("leads from the last year back to the one before, keeping the month, and has no next year", async () => {
      const nav = arrows(await render({ year: "2026", month: "2026-10" }));
      expect(nav).toMatch(/<a [^>]*aria-label="Previous year"[^>]*href="\/year\?year=2025&amp;month=2026-10"[^>]*><svg[^>]*>[\s\S]*?<\/svg><\/a>/);
      expect(nav).toMatch(/<span role="link" aria-disabled="true" aria-label="Next year"/);
    });

    it("leads from the first year on to the next, and has no previous year", async () => {
      const nav = arrows(await render({ year: "2025", month: "2026-10" }));
      expect(nav).toMatch(/<span role="link" aria-disabled="true" aria-label="Previous year"/);
      expect(nav).toMatch(/<a [^>]*aria-label="Next year"[^>]*href="\/year\?year=2026&amp;month=2026-10"[^>]*><svg[^>]*>[\s\S]*?<\/svg><\/a>/);
    });

    it("keeps no month in the arrows when the address has none", async () => {
      const nav = arrows(await render({ year: "2026" }));
      expect(nav).toContain('href="/year?year=2025"');
    });

    it("makes each arrow a 44 px square that answers a press", async () => {
      const html = await render({ year: "2026", month: "2026-10" });
      expect(smallTargets(arrows(html))).toEqual([]);
      expect(unpressedTargets(arrows(html))).toEqual([]);
    });
  });

  it("brings a year past the end back to the last year of the Schedule", async () => {
    const nav = arrows(await render({ year: "2031" }));
    expect(nav).toMatch(/aria-label="Previous year"[^>]*href="\/year\?year=2026"/);
    expect(nav).toMatch(/<span role="link" aria-disabled="true" aria-label="Next year"/);
  });
});

describe("the Year page for the fixture year (2026, today 17 October)", () => {
  it("sums what was received of what fell due, with a bar for the share", async () => {
    const html = await render({ year: "2026" });
    const summary = /<section[^>]*aria-label="Received in 2026"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(summary).toContain("rounded-card border border-line bg-surface p-4 shadow-card");
    expect(visibleText(summary)).toBe(`Received ${formatRupees(59400)} of ${formatRupees(92285)}`);
    expect(summary).toMatch(/<p class="[^"]*\btext-2xl\b[^"]*\bfont-bold\b[^"]*">/);
    // 59,400 of 92,285 is 64%
    expect(summary).toContain('role="presentation"');
    expect(summary).toContain('style="width:64%"');
  });

  it("draws a card for each of the five portions, in Settings order, each with twelve months", async () => {
    const html = await render({ year: "2026" });
    expect(headingsIn(html)).toEqual(PORTIONS.map((portion) => portion.name));
    const cards = portionCards(html);
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(card).toMatch(/<ol aria-label="Months of 2026[^"]*" class="mt-2 grid grid-cols-6 gap-1\.5">/);
      expect(cellsOf(card)).toHaveLength(12);
    }
  });

  it("says what each portion received of what is due", async () => {
    const cards = portionCards(await render({ year: "2026" }));
    // Aug and Sep paid, October unpaid and due
    expect(visibleText(cards[0])).toContain(`${formatRupees(10900)} of ${formatRupees(16350)}`);
    expect(visibleText(cards[3])).toContain(`${formatRupees(0)} of ${formatRupees(0)}`);
  });

  it("links each month to its screen, and this month to the month screen's own address", async () => {
    const [first] = portionCards(await render({ year: "2026" }));
    const cells = cellsOf(first);
    expect(cells[7]).toContain('href="/?month=2026-08"');
    expect(cells[8]).toContain('href="/?month=2026-09"');
    // October is this month: the month screen lives at "/"
    expect(cells[9]).toMatch(/href="\/"/);
    // not yet due: still a link, to its month
    expect(cells[10]).toContain('href="/?month=2026-11"');
    expect(cells[11]).toContain('href="/?month=2026-12"');
  });

  it("shows the short month name over the glyph of its state, in each cell", async () => {
    const [first] = portionCards(await render({ year: "2026" }));
    const cells = cellsOf(first);
    expect(visibleText(cells[7])).toMatch(/^Aug ✓/);
    expect(visibleText(cells[9])).toMatch(/^Oct !/);
    expect(visibleText(cells[10])).toMatch(/^Nov ·/);
    expect(cells[7]).toMatch(/<span>Aug<\/span><span aria-hidden="true" class="[^"]*">✓<\/span>/);
  });

  it("makes a month before the Schedule a muted dash that is not a link", async () => {
    const [first] = portionCards(await render({ year: "2026" }));
    const january = cellsOf(first)[0];
    expect(january).not.toContain("<a ");
    expect(january).toContain(`<span class="`);
    expect(/class="([^"]*)"/.exec(january)?.[1]).toContain(yearCellClasses("none"));
    expect(january).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(january).toContain('<span aria-hidden="true" class="text-base leading-none">—</span>');
    expect(visibleText(january)).toContain("January 2026, First floor, single bedroom: no record");
  });

  it("explains each glyph in a key of glyph and word", async () => {
    const html = await render({ year: "2026" });
    const key = /<ul aria-label="Key"[^>]*>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(key.match(/<li/g)).toHaveLength(YEAR_LEGEND.length);
    for (const { state, glyph, label } of YEAR_LEGEND) {
      expect(key).toMatch(new RegExp(`<span aria-hidden="true" class="[^"]*${yearCellClasses(state)}">${glyph}</span>${label}</li>`));
    }
    // the key sits between the summary and the cards
    expect(html.indexOf('aria-label="Key"')).toBeGreaterThan(html.indexOf("Received in 2026"));
    expect(html.indexOf('aria-label="Key"')).toBeLessThan(html.indexOf("First floor, single bedroom"));
  });

  it("has no empty state and no problem block", async () => {
    const html = await render({ year: "2026" });
    expect(html).not.toContain("Nothing recorded for");
    expect(html).not.toContain('role="alert"');
  });
});

describe("a label for each state a month can be in", () => {
  // p1: Aug paid, Sep paid, Oct paid 5,000 against 5,450 (still paid); p2 owes October; p4 was never let; Jan to Jul are before the Schedule
  const rows = () => baseRows([2026, 10, [["Asha", 4, 5000], null, ["Chitra", 6, 9000], null, ["Esha", 2, 5100]]]);

  it.each([
    ["paid", `August 2026, First floor, single bedroom: paid ${formatRupees(5450)}`],
    ["paid at another amount", `October 2026, First floor, single bedroom: paid ${formatRupees(5000)}`],
    ["unpaid", `October 2026, First floor, double bedroom: unpaid, ${formatRupees(13335)} due`],
    ["vacant", "October 2026, Second floor, double bedroom: vacant"],
    ["not due yet", "November 2026, First floor, single bedroom: not due yet"],
  ])("gives a month that is %s its words as the name of its link", async (_state, label) => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: rows() }));
    expect(await render({ year: "2026" })).toContain(`<a aria-label="${label}"`);
  });

  it("says no record in words only a screen reader hears, for a month that is not a link", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: rows() }));
    const html = await render({ year: "2026" });
    expect(html).toContain('<span class="sr-only">January 2026, First floor, single bedroom: no record</span>');
    expect(html).not.toContain("aria-label=\"January 2026");
  });

  it("colours each state with its own tokens, on a 44 px cell", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: rows() }));
    const cards = portionCards(await render({ year: "2026" }));
    const classOf = (cell: string) => /class="([^"]*)"/.exec(cell)?.[1] ?? "";
    const cell = (card: number, month: number) => cellsOf(cards[card])[month - 1];
    const expected: [number, number, YearCellState][] = [
      [0, 8, "paid"],
      [0, 10, "paid"],
      [1, 10, "unpaid"],
      [3, 10, "vacant"],
      [0, 11, "upcoming"],
      [0, 1, "none"],
    ];
    for (const [card, month, state] of expected) {
      expect(classOf(cell(card, month)), `${state}`).toContain(yearCellClasses(state));
      expect(classOf(cell(card, month)), `${state}`).toMatch(/\bmin-h-11\b/);
      expect(classOf(cell(card, month)), `${state}`).toMatch(/\brounded-chip\b/);
    }
  });
});

describe("the Year page for a year with nothing in it", () => {
  it("says so, and where the Schedule starts, with a way to that year", async () => {
    const html = await render({ year: "2024", month: "2026-10" });
    expect(visibleText(html)).toContain("Nothing recorded for 2024");
    expect(visibleText(html)).toContain("Your Schedule starts in August 2026.");
    expect(html).toContain(`<a class="${buttonClasses("secondary", "md")}" href="/year?year=2026&amp;month=2026-10">Show 2026</a>`);
  });

  it("leaves out the summary, the key and the cards, but keeps the switcher so the person can move on", async () => {
    const html = await render({ year: "2024" });
    expect(html).not.toContain("Received in");
    expect(html).not.toContain('aria-label="Key"');
    expect(html).not.toContain("grid-cols-6");
    expect(html).toContain('<nav aria-label="Year"');
    expect(html).toMatch(/aria-label="Next year"[^>]*href="\/year\?year=2026"/);
  });

  it("says the Schedule has no months yet when it has none", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: [] }));
    const html = await render({ year: "2026" });
    expect(visibleText(html)).toContain("Nothing recorded for 2026");
    expect(visibleText(html)).toContain("Your Schedule has no months yet.");
    expect(html).not.toContain("Show 20");
  });

  it("gives no link to the year it is already on", async () => {
    // the Schedule starts in 2026, but Settings has no portions, so there is nothing to draw in 2026
    mocks.loadPageSnapshot.mockResolvedValue({ portions: [], rows: baseRows(), tenancies: [] });
    const html = await render({ year: "2026" });
    expect(visibleText(html)).toContain("Nothing recorded for 2026");
    expect(visibleText(html)).toContain("Your Schedule starts in August 2026.");
    expect(html).not.toContain("Show 2026");
  });
});

describe("the Year page when the Tenants tab cannot be read", () => {
  it("still shows the year, under a warning that months after a move-out may read as unpaid", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ tenantsProblem: "The Tenants tab has no Phone header." }));
    const html = await render({ year: "2026" });
    expect(html).toContain(`<p class="${noticeClasses("warn")} mt-3">`);
    expect(visibleText(html)).toContain(
      "The Tenants tab can't be read, so months after a move-out may show as unpaid. The Tenants tab has no Phone header.",
    );
    expect(portionCards(html)).toHaveLength(5);
  });

  it("shows no warning when the Tenants tab is fine", async () => {
    expect(visibleText(await render({ year: "2026" }))).not.toContain("Tenants tab can't be read");
  });
});

describe("the Year page when the Sheet cannot be read", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadPageSnapshot.mockRejectedValue(new AppError("sheet-structure", "The Schedule tab has no Month header."));
  });
  afterEach(() => log.mockRestore());

  it("explains the problem in place of the year, with Try again for the same year and month", async () => {
    const html = await render({ year: "2025", month: "2026-08" });
    expect(html).toContain("The Schedule tab has no Month header.");
    expect(html).toMatch(/<a [^>]*href="\/year\?year=2025&amp;month=2026-08"[^>]*>Try again<\/a>/);
    expect(html).not.toContain("Received in");
    expect(html).not.toContain("Nothing recorded");
    expect(html).not.toContain('<nav aria-label="Year"');
  });

  it("keeps the header and the way back", async () => {
    const html = await render();
    expect(html).toContain("Year at a glance</h1>");
    expect(html).toContain('aria-label="Back to month"');
  });

  it("offers the owner Set up, in the month that was showing, and a member nothing", async () => {
    mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    expect(await render({ month: "2026-08" })).toMatch(/<a [^>]*href="\/setup\?month=2026-08"[^>]*>Open Set up to see what is wrong<\/a>/);
    mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
    expect(await render()).not.toContain("/setup");
  });
});

describe("touch and accessibility", () => {
  it("gives every link of the page a 44 px target that answers a press, with a year or without", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: twoYears() }));
    for (const params of [{ year: "2026", month: "2026-10" }, { year: "2025" }, { year: "2031" }, {}]) {
      const html = await render(params);
      expect(smallTargets(html), JSON.stringify(params)).toEqual([]);
      expect(unpressedTargets(html), JSON.stringify(params)).toEqual([]);
    }
  });

  it("does so for the empty year and the problem block too", async () => {
    const empty = await render({ year: "2024" });
    expect(smallTargets(empty)).toEqual([]);
    expect(unpressedTargets(empty)).toEqual([]);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    mocks.loadPageSnapshot.mockRejectedValue(new AppError("config", "The key is wrong."));
    const problem = await render();
    log.mockRestore();
    expect(problem).toContain("Open Set up");
    expect(smallTargets(problem)).toEqual([]);
    expect(unpressedTargets(problem)).toEqual([]);
  });

  it("never tells a state by colour alone: every cell has a glyph or a dash beside the month name", async () => {
    const html = await render({ year: "2026" });
    for (const card of portionCards(html)) {
      for (const cell of cellsOf(card)) {
        expect(visibleText(cell.replace(/<span class="sr-only">[^<]*<\/span>/, ""))).toMatch(/^[A-Z][a-z]{2} \S$/);
      }
    }
  });
});
