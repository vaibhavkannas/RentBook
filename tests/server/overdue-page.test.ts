import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { formatRupees } from "@/lib/format";
import { MOVED_OUT_HINT, OVERDUE_RULES } from "@/lib/report-copy";
import { buttonClasses, CARD, noticeClasses, pillClasses } from "@/lib/ui-classes";
import { smallTargets, unpressedTargets } from "../support/tap-targets";
import { baseRows, PORTIONS, parsedRows, tenancyRow } from "../support/fixtures";
import type { Tenancy } from "@/lib/domain/tenancy";
import type { ScheduleRow } from "@/lib/domain/types";
import { addMonths } from "@/lib/domain/year-month";

// The Overdue screen: who owes rent and since when, from the one snapshot the Month screen reads, with the data layer
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
  usePathname: () => "/overdue",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ loadPageSnapshot: mocks.loadPageSnapshot }));

import OverduePage from "@/app/overdue/page";

/** 17 October 2026, noon in India: this month is October, and the 16 days since the 1st make a month overdue. */
const NOW = new Date("2026-10-17T06:30:00Z");

type SnapshotOptions = { rows?: ScheduleRow[]; tenancies?: Tenancy[]; tenantsProblem?: string };

const snapshot = ({ rows = baseRows(), tenancies = [], tenantsProblem }: SnapshotOptions = {}) => ({
  portions: PORTIONS,
  rows,
  tenancies,
  tenantsProblem,
});

async function render(searchParams: Record<string, string | string[] | undefined> = {}): Promise<string> {
  const page = (await OverduePage({ searchParams: Promise.resolve(searchParams) })) as ReactElement;
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

/** The cards of the portions that owe, in the order the page draws them. */
const itemCards = (html: string) => html.split("<li class=\"" + CARD + "\">").slice(1).map((part) => part.split("</li></ul>")[0]);

const headingsIn = (html: string) => [...html.matchAll(/<h2 class="[^"]*">([^<]*)<\/h2>/g)].map((match) => match[1]);

/** The months of one portion's list: their links in order. */
const monthLinks = (card: string) => [...card.matchAll(/<a [^>]*href="([^"]*)"[^>]*><span[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({ href: match[1], text: visibleText(match[2]) }));

/**
 * A Schedule where Asha (p1) last paid `monthsBehind` months before October 2026 and has paid nothing since, so her portion owes
 * the `monthsBehind` months after that, up to October 2026; Bala (p2) pays every month, so nobody else owes.
 */
function behind(monthsBehind: number): ScheduleRow[] {
  const lastPaid = addMonths({ year: 2026, month: 10 }, -monthsBehind);
  const months: Parameters<typeof parsedRows> = [[lastPaid.year, lastPaid.month, [["Asha", 1, 5450], ["Bala", 1, 12700]]]];
  for (let step = 1; step <= monthsBehind; step++) {
    const month = addMonths(lastPaid, step);
    months.push([month.year, month.month, [null, ["Bala", step + 1, 12700]]]);
  }
  return parsedRows(...months);
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.loadPageSnapshot.mockResolvedValue(snapshot());
});
afterEach(() => vi.useRealTimers());

describe("the Overdue page", () => {
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

  it("is titled Overdue rent, with an arrow back to the month that was showing", async () => {
    nav.search = "month=2026-08";
    const html = await render({ month: "2026-08" });
    expect(html).toContain('<h1 class="min-w-0 break-words text-lg font-semibold">Overdue rent</h1>');
    expect(html).toMatch(/<a [^>]*aria-label="Back to month"[^>]*>‹<\/a>/);
    expect(html).toMatch(/<a [^>]*aria-label="Back to month"[^>]*href="\/\?month=2026-08"/);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("makes room for the tab bar", async () => {
    expect(await render()).toMatch(/^<main class="[^"]*\bpb-tabbar\b/);
  });
});

describe("the Overdue page with rent owed", () => {
  it("sums what is owed, says how many portions and the month it counts up to", async () => {
    const html = await render();
    const summary = /<section[^>]*aria-label="Overdue summary"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(summary).toMatch(/<p class="[^"]*\btext-2xl\b[^"]*\bfont-semibold\b[^"]*">/);
    expect(visibleText(summary)).toContain(`${formatRupees(32885)} overdue`);
    expect(visibleText(summary)).toContain("4 portions · counted up to October 2026");
    expect(summary).toContain(`class="${CARD}`);
  });

  it("says portion, not portions, for one", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: baseRows([2026, 10, [["Asha", 4, 5450], ["Bala", 1, 13335], ["Chitra", 6, 9000], null, null]]) }));
    expect(visibleText(await render())).toContain("1 portion · counted up to October 2026");
  });

  it("draws a card for each portion that owes, most owed first, each with its rupee pill", async () => {
    const html = await render();
    expect(headingsIn(html)).toEqual([
      "First floor, double bedroom",
      "Second floor, single bedroom",
      "First floor, single bedroom",
      "Third floor, hall and kitchen",
    ]);
    const cards = itemCards(html);
    expect(cards).toHaveLength(4);
    const owed = [13335, 9000, 5450, 5100];
    cards.forEach((card, index) => {
      expect(card).toContain(`<span class="${pillClasses("danger")}">${formatRupees(owed[index])}</span>`);
      expect(card).toMatch(/<h2 class="[^"]*\bfont-medium\b/);
    });
    // the portion that was never let owes nothing and has no card
    expect(html).not.toContain("Second floor, double bedroom");
  });

  it("says who owes and for how many months, and the oldest month with its age", async () => {
    const [first, second] = itemCards(await render());
    expect(visibleText(first)).toContain("Bala · 1 unpaid month");
    expect(visibleText(first)).toContain("Oldest: October 2026, 16 days overdue");
    expect(visibleText(second)).toContain("Chitra · 1 unpaid month");
  });

  it("lists each month as a link to that month, with what is owed for it", async () => {
    const [first] = itemCards(await render());
    const links = monthLinks(first);
    // October is this month, which lives at "/"
    expect(links).toEqual([{ href: "/", text: `October 2026 Unpaid: ${formatRupees(13335)} ›` }]);
    expect(first).toMatch(/<ol [^>]*aria-label="[^"]*"/);
  });

  it("makes every month link a full 44 px row that answers a press", async () => {
    const [first] = itemCards(await render());
    expect(first).toMatch(/<a [^>]*class="[^"]*\bmin-h-11\b[^"]*\bpress\b|<a [^>]*class="[^"]*\bpress\b[^"]*\bmin-h-11\b/);
  });

  describe("a portion that is behind for several months", () => {
    beforeEach(() => mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: behind(5) })));

    it("lists its months newest first, each linking to its own month", async () => {
      const html = await render();
      expect(headingsIn(html)).toEqual(["First floor, single bedroom"]);
      const [card] = itemCards(html);
      expect(monthLinks(card)).toEqual([
        { href: "/", text: `October 2026 Unpaid: ${formatRupees(5450)} ›` },
        { href: "/?month=2026-09", text: `September 2026 Unpaid: ${formatRupees(5450)} ›` },
        { href: "/?month=2026-08", text: `August 2026 Unpaid: ${formatRupees(5450)} ›` },
        { href: "/?month=2026-07", text: `July 2026 Unpaid: ${formatRupees(5450)} ›` },
        { href: "/?month=2026-06", text: `June 2026 Unpaid: ${formatRupees(5450)} ›` },
      ]);
      expect(visibleText(card)).toContain("Asha · 5 unpaid months");
      expect(visibleText(card)).toContain("Oldest: June 2026, about 5 months overdue");
      expect(visibleText(html)).toContain(`${formatRupees(27250)} overdue`);
    });

    it("says a month paid short with what was paid and what is missing, as the card does", async () => {
      // September is paid 450 short of the 5,450 rent; October's card then suggests the 5,000 last paid
      const short = parsedRows(
        [2026, 8, [["Asha", 1, 5450], ["Bala", 3, 12700]]],
        [2026, 9, [["Asha", 2, 5000], ["Bala", 4, 12700]]],
        [2026, 10, [null, ["Bala", 5, 12700]]],
      );
      mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: short }));
      const [card] = itemCards(await render());
      expect(monthLinks(card).map((link) => link.text)).toEqual([
        `October 2026 Unpaid: ${formatRupees(5000)} ›`,
        `September 2026 Paid ${formatRupees(5000)} of ${formatRupees(5450)}: ${formatRupees(450)} short ›`,
      ]);
      expect(visibleText(card)).toContain("Asha · 1 unpaid month · 1 paid short");
      expect(visibleText(card)).toContain("Oldest: September 2026");
    });

    it("sends the person to the tenant page when the oldest month is more than three months back, keeping the month", async () => {
      // June is four months before October
      const [card] = itemCards(await render({ month: "2026-10" }));
      expect(visibleText(card)).toContain(MOVED_OUT_HINT);
      const link = /<a [^>]*href="\/tenants\/p1\?month=2026-10"[^>]*>([\s\S]*?)<\/a>/.exec(card);
      expect(link?.[1]).toBe("Tenant page");
      expect(link?.[0]).toMatch(/class="[^"]*\bmin-h-11\b/);
      expect(link?.[0]).toContain('aria-label="Tenant page for First floor, single bedroom"');
    });

    it("leaves the hint and the tenant page link out when the oldest month is three months back", async () => {
      mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: behind(4) }));
      const [card] = itemCards(await render());
      expect(visibleText(card)).toContain("Oldest: July 2026");
      expect(monthLinks(card)).toHaveLength(4);
      expect(card).not.toContain(MOVED_OUT_HINT);
      expect(card).not.toContain("Tenant page");
    });

    it("carries no month to the tenant page when the address has none", async () => {
      const [card] = itemCards(await render());
      expect(card).toContain('href="/tenants/p1"');
    });
  });

  describe("a portion that has been behind for more than a year", () => {
    it("lists the 12 newest months and says how many earlier ones there are", async () => {
      mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: behind(16) }));
      const [card] = itemCards(await render());
      const links = monthLinks(card);
      // July 2025 to October 2026 is 16 months
      expect(links).toHaveLength(12);
      expect(links[0].text).toContain("October 2026");
      expect(links[11].text).toContain("November 2025");
      expect(visibleText(card)).toContain("and 4 earlier months");
      expect(visibleText(card)).toContain("Oldest: July 2025");
    });

    it("lists all 12 and no earlier-months line for exactly 12", async () => {
      mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: behind(12) }));
      const [card] = itemCards(await render());
      expect(monthLinks(card)).toHaveLength(12);
      expect(card).not.toContain("earlier month");
    });

    it("says month, not months, for one earlier month", async () => {
      mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: behind(13) }));
      const [card] = itemCards(await render());
      expect(monthLinks(card)).toHaveLength(12);
      expect(visibleText(card)).toContain("and 1 earlier month");
      expect(visibleText(card)).not.toContain("earlier months");
    });
  });

  it("explains how it is worked out, in a details element with the rules", async () => {
    const html = await render();
    const details = /<details[^>]*>[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
    expect(details).toMatch(/<summary [^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>How this is worked out<span/);
    for (const rule of OVERDUE_RULES) expect(visibleText(details)).toContain(rule);
    expect(details.match(/<li/g)).toHaveLength(OVERDUE_RULES.length);
    // it follows the cards
    expect(html.indexOf("<details")).toBeGreaterThan(html.lastIndexOf("Third floor, hall and kitchen"));
  });

  it("has no empty state and no problem block", async () => {
    const html = await render();
    expect(html).not.toContain("Nothing overdue");
    expect(html).not.toContain('role="alert"');
  });
});

describe("the Overdue page with nothing owed", () => {
  const allPaid = () =>
    snapshot({ rows: baseRows([2026, 10, [["Asha", 4, 5450], ["Bala", 1, 13335], ["Chitra", 6, 9000], null, ["Esha", 2, 5100]]]) });

  beforeEach(() => mocks.loadPageSnapshot.mockResolvedValue(allPaid()));

  it("says so, up to the month it counts, with a way back to the month", async () => {
    const html = await render();
    expect(visibleText(html)).toContain("Nothing overdue");
    expect(visibleText(html)).toContain("Every let portion has paid in full up to October 2026.");
    expect(html).toContain(`<a class="${buttonClasses("secondary", "md")}" href="/">Back to the month</a>`);
  });

  it("leaves out the summary and the cards", async () => {
    const html = await render();
    expect(html).not.toContain("Overdue summary");
    expect(html).not.toContain("counted up to");
    expect(html).not.toContain("<h2");
  });

  it("leads back to the month that was showing", async () => {
    expect(await render({ month: "2026-08" })).toContain(`<a class="${buttonClasses("secondary", "md")}" href="/?month=2026-08">Back to the month</a>`);
  });

  it("still explains how it is worked out", async () => {
    const html = await render();
    expect(html).toContain("How this is worked out");
    expect(visibleText(html)).toContain(OVERDUE_RULES[0]);
  });

  it("counts up to September before the 6th of October", async () => {
    vi.setSystemTime(new Date("2026-10-05T06:30:00Z"));
    mocks.loadPageSnapshot.mockResolvedValue(snapshot());
    expect(visibleText(await render())).toContain("Every let portion has paid in full up to September 2026.");
  });
});

describe("the Overdue page when the Tenants tab cannot be read", () => {
  it("still lists who owes, under a warning that tenants who moved out may show", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ tenantsProblem: "The Tenants tab has no Phone header." }));
    const html = await render();
    expect(html).toContain(`<p class="${noticeClasses("warn")} mt-3">`);
    expect(visibleText(html)).toContain(
      "The Tenants tab can't be read, so tenants who moved out may show here. The Tenants tab has no Phone header.",
    );
    expect(headingsIn(html)).toHaveLength(4);
    expect(html).not.toContain('role="alert"');
  });

  it("shows no warning when the Tenants tab is fine", async () => {
    expect(visibleText(await render())).not.toContain("Tenants tab can't be read");
  });

  it("shows the warning with an empty list too", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(
      snapshot({ rows: baseRows([2026, 10, [["Asha", 4, 5450], ["Bala", 1, 13335], ["Chitra", 6, 9000], null, ["Esha", 2, 5100]]]), tenantsProblem: "The Tenants tab has no Phone header." }),
    );
    const html = await render();
    expect(visibleText(html)).toContain("Tenants tab can't be read");
    expect(visibleText(html)).toContain("Nothing overdue");
  });
});

describe("the Overdue page when the Sheet cannot be read", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadPageSnapshot.mockRejectedValue(new AppError("sheet-structure", "The Schedule tab has no Month header."));
  });
  afterEach(() => log.mockRestore());

  it("explains the problem in place of the list, with Try again for the same month", async () => {
    const html = await render({ month: "2026-08" });
    expect(html).toContain("The Schedule tab has no Month header.");
    expect(html).toMatch(/<a [^>]*href="\/overdue\?month=2026-08"[^>]*>Try again<\/a>/);
    expect(html).not.toContain("Overdue summary");
    expect(html).not.toContain("How this is worked out");
    expect(html).not.toContain("Nothing overdue");
  });

  it("keeps the header and the way back", async () => {
    const html = await render();
    expect(html).toContain("Overdue rent</h1>");
    expect(html).toContain('aria-label="Back to month"');
  });

  it("offers the owner Set up for a problem Set up can explain, in the month that was showing", async () => {
    mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    expect(await render({ month: "2026-08" })).toMatch(/<a [^>]*href="\/setup\?month=2026-08"[^>]*>Open Set up to see what is wrong<\/a>/);
  });

  it("does not offer a member Set up", async () => {
    expect(await render()).not.toContain("/setup");
  });

  it("tells a failure that is not ours in plain words", async () => {
    mocks.loadPageSnapshot.mockRejectedValue(new Error("socket hang up"));
    const html = await render();
    expect(visibleText(html)).toContain("Couldn't reach Google Sheets. Try again.");
    expect(html).not.toContain("socket hang up");
  });
});

describe("the Overdue page and tenants who moved out", () => {
  it("does not list a portion whose tenant is recorded as moved out, when the Schedule shows later months by someone else", async () => {
    const rows = parsedRows(
      [2026, 8, [["Asha", 1, 5450], ["Bala", 3, 12700]]],
      [2026, 9, [["Hari", 1, 5450], ["Bala", 4, 12700]]],
      [2026, 10, [["Hari", 2, 5450], ["Bala", 5, 12700]]],
    );
    mocks.loadPageSnapshot.mockResolvedValue(
      snapshot({ rows, tenancies: [tenancyRow({ moveOut: "2026-08-31" })] }),
    );
    expect(visibleText(await render())).toContain("Nothing overdue");
  });
});

describe("touch and accessibility", () => {
  it.each([
    ["with rent owed", () => snapshot()],
    ["with a long list", () => snapshot({ rows: behind(16) })],
  ])("gives every link and button of the page %s a 44 px target that answers a press", async (_name, make) => {
    mocks.loadPageSnapshot.mockResolvedValue(make());
    const html = await render({ month: "2026-10" });
    expect(smallTargets(html)).toEqual([]);
    expect(unpressedTargets(html)).toEqual([]);
  });

  it("gives the links of the empty state and of the problem block a 44 px target too", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(
      snapshot({ rows: baseRows([2026, 10, [["Asha", 4, 5450], ["Bala", 1, 13335], ["Chitra", 6, 9000], null, ["Esha", 2, 5100]]]) }),
    );
    const empty = await render();
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
});
