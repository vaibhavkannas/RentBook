import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthView, PortionCard } from "@/lib/domain/types";
import { AppError, unavailable } from "@/lib/errors";
import { baseRows, PORTIONS, tenancyRow } from "../support/fixtures";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// A smoke test of the home page: the month summary and the cards, with the data layer replaced. The
// client components render their first (server) output only.

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  loadMonthView: vi.fn(),
  loadPageSnapshot: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ loadMonthView: mocks.loadMonthView, loadPageSnapshot: mocks.loadPageSnapshot }));

import Home from "@/app/page";

function card(overrides: Partial<PortionCard> = {}): PortionCard {
  return {
    portionId: "p1",
    name: "Ground floor",
    cycleLength: 11,
    status: "pending",
    entry: null,
    next: { tenant: "Asha", count: 4, suggestedAmount: 5450, previousAmount: 5450, startsNewCycle: false },
    undoBlockedReason: null,
    tenancy: null,
    rentReference: 5450,
    rentDifference: null,
    ...overrides,
  };
}

function view(overrides: Partial<MonthView> = {}): MonthView {
  return {
    month: { year: 2026, month: 10 },
    cards: [card()],
    received: 0,
    due: 5450,
    difference: 0,
    paidCount: 0,
    ...overrides,
  };
}

async function render(searchParams: { month?: string } = { month: "2026-10" }): Promise<string> {
  const page = (await Home({ searchParams: Promise.resolve(searchParams) })) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

/** The text of the month summary section. */
function summary(html: string): string {
  return html.match(/<section[^>]*aria-label="Month summary"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.loadMonthView.mockResolvedValue(view());
  // A quiet Sheet: nothing is overdue, no agreement or hike is coming, so the Needs attention card has nothing to say.
  mocks.loadPageSnapshot.mockResolvedValue({ portions: [], rows: [], tenancies: [] });
});

describe("the home page", () => {
  it("sends a person who is not signed in to the sign-in page", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
  });

  it("explains a problem loading the Sheet instead of the summary", async () => {
    mocks.loadMonthView.mockRejectedValue(new AppError("sheet-structure", "The Schedule tab has no Month header."));
    const html = await render();
    expect(html).toContain("The Schedule tab has no Month header.");
    expect(summary(html)).toBe("");
  });
});

describe("the home page without a footer", () => {
  it("no longer carries who is signed in, the Activity and settings links or Sign out: the tab bar and More have them", async () => {
    mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    const html = await render();
    expect(html).not.toContain("Signed in as");
    expect(html).not.toContain("owner@example.com");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Portion settings");
    expect(html).not.toContain('href="/activity"');
    expect(html).not.toContain("<footer");
  });

  it("leaves room for the tab bar under the last card", async () => {
    expect(await render()).toMatch(/^<main class="[^"]*\bpb-tabbar\b/);
  });
});

describe("the link to the Year screen", () => {
  const link = (html: string) => /<a [^>]*href="\/year\?[^"]*"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";

  it("sits in the month summary, under the progress bar, as a quiet 44 px link", async () => {
    const out = summary(await render());
    const year = link(out);
    expect(year).toContain(">Year at a glance</a>");
    expect(year).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(year).toMatch(/class="[^"]*\btext-muted\b[^"]*\bunderline\b|class="[^"]*\bunderline\b[^"]*\btext-muted\b/);
    expect(out.indexOf('role="presentation"')).toBeLessThan(out.indexOf("Year at a glance"));
    expect(smallTargets(year)).toEqual([]);
    expect(unpressedTargets(year)).toEqual([]);
  });

  it("carries the month on show and its year", async () => {
    expect(link(await render({ month: "2026-10" }))).toContain('href="/year?year=2026&amp;month=2026-10"');
    expect(link(await render({ month: "2025-12" }))).toContain('href="/year?year=2025&amp;month=2025-12"');
    expect(link(await render({ month: "2026-02" }))).toContain('href="/year?year=2026&amp;month=2026-02"');
  });

  it("carries this month, with its year, when the address has no month", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T06:30:00Z") });
    try {
      expect(link(await render({}))).toContain('href="/year?year=2026&amp;month=2026-10"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not there when the Sheet could not be read: the summary is not either", async () => {
    mocks.loadMonthView.mockRejectedValue(new AppError("sheet-structure", "The Schedule tab has no Month header."));
    expect(await render()).not.toContain("Year at a glance");
  });
});

describe("the Needs attention card", () => {
  /** 17 October 2026, noon in India: this month is October, and the base Schedule's four let portions are overdue. */
  const NOW = new Date("2026-10-17T06:30:00Z");
  const busy = (tenancies = [tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2026-10-05" })]) => ({
    portions: PORTIONS,
    rows: baseRows(),
    tenancies,
  });
  const card = (html: string) => /<section aria-label="Needs attention"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  const rowsIn = (html: string) =>
    [...card(html).matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
      href: match[1],
      text: match[2].replace(/<[^>]+>/g, "").replace(/ ?›$/, "").trim(),
    }));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    mocks.loadPageSnapshot.mockResolvedValue(busy());
  });
  afterEach(() => vi.useRealTimers());

  it("shows, this month, a row for overdue rent, an ended agreement and a hike, in that order, each with its screen", async () => {
    const html = await render({ month: "2026-10" });
    expect(rowsIn(html)).toEqual([
      { href: "/overdue?month=2026-10", text: "Rent overdue: 4 portions, ₹\u00a032,885" },
      { href: "/alerts?month=2026-10", text: "1 agreement ended" },
      { href: "/alerts?month=2026-10#hikes", text: "Rent goes up soon for 1 portion" },
    ]);
  });

  it("is this month's, so it shows when the address has no month too", async () => {
    expect(rowsIn(await render({})).map((row) => row.href)).toEqual([
      "/overdue?month=2026-10",
      "/alerts?month=2026-10",
      "/alerts?month=2026-10#hikes",
    ]);
  });

  it("sits between the month header and the summary", async () => {
    const html = await render({ month: "2026-10" });
    expect(html.indexOf('<nav aria-label="Month"')).toBeLessThan(html.indexOf('aria-label="Needs attention"'));
    expect(html.indexOf('aria-label="Needs attention"')).toBeLessThan(html.indexOf('aria-label="Month summary"'));
  });

  it("reads the snapshot for the signed-in person, after the month view", async () => {
    await render({ month: "2026-10" });
    expect(mocks.loadPageSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.loadPageSnapshot).toHaveBeenCalledWith(expect.anything(), "member@example.com");
    expect(mocks.loadMonthView.mock.invocationCallOrder[0]).toBeLessThan(mocks.loadPageSnapshot.mock.invocationCallOrder[0]);
  });

  it("has no card for another month, and does not read the snapshot for one", async () => {
    for (const month of ["2026-09", "2026-11", "2025-10"]) {
      expect(await render({ month })).not.toContain("Needs attention");
    }
    expect(mocks.loadPageSnapshot).not.toHaveBeenCalled();
  });

  it("has no card when nothing is due", async () => {
    mocks.loadPageSnapshot.mockResolvedValue({ portions: [], rows: [], tenancies: [] });
    const html = await render({ month: "2026-10" });
    expect(html).not.toContain("Needs attention");
    expect(html).toContain('aria-label="Month summary"');
  });

  it("has no card when the month view could not be read, and the problem is the only thing said", async () => {
    mocks.loadMonthView.mockRejectedValue(new AppError("sheet-structure", "The Schedule tab has no Month header."));
    const html = await render({ month: "2026-10" });
    expect(html).not.toContain("Needs attention");
    expect(html).toContain("The Schedule tab has no Month header.");
    expect(mocks.loadPageSnapshot).not.toHaveBeenCalled();
  });

  it("shows nothing, and the rest of the page as usual, when its own read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.loadPageSnapshot.mockRejectedValue(unavailable());
      const html = await render({ month: "2026-10" });
      expect(html).not.toContain("Needs attention");
      expect(html).toContain('aria-label="Month summary"');
      expect(html).not.toContain('role="alert"');
      // the failure is logged, in words that carry no tenant's name
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("attention-card-failed");
      expect(String(warn.mock.calls[0][0])).not.toContain("Asha");
    } finally {
      warn.mockRestore();
    }
  });

  it("gives every row a 44 px target that answers a press", async () => {
    const out = card(await render({ month: "2026-10" }));
    expect(out).not.toBe("");
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
  });

  it("adds a row for an agreement that ends soon", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(
      busy([
        tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2026-10-05" }),
        tenancyRow({ id: "t-3", portionId: "p3", tenant: "Chitra", agreementEnd: "2026-12-01" }),
      ]),
    );
    expect(rowsIn(await render({ month: "2026-10" })).map((row) => row.text)).toEqual([
      "Rent overdue: 4 portions, ₹\u00a032,885",
      "1 agreement ended",
      "1 agreement ends within 60 days",
      "Rent goes up soon for 1 portion",
    ]);
  });
});

describe("the exit guard on the home page", () => {
  it("has its empty live region on the page, with no toast on a normal visit", async () => {
    const html = await render();
    expect(html).toMatch(/<div role="status" class="pointer-events-none fixed[^"]*"><\/div>/);
    expect(html).not.toContain("Press back again to exit");
  });

  it("is there when the Sheet could not be read, too", async () => {
    mocks.loadMonthView.mockRejectedValue(new AppError("sheet-structure", "The Schedule tab has no Month header."));
    expect(await render()).toMatch(/<div role="status" class="pointer-events-none fixed[^"]*"><\/div>/);
  });
});

describe("the month summary: received against rent due", () => {
  it("shows what was received of the rent due, and no difference line when they match", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ received: 5450, due: 5450, difference: 0, paidCount: 1 }),
    );
    const out = summary(await render());
    expect(out).toContain("₹ 5,450");
    expect(out).toContain("of ₹ 5,450");
    expect(out).not.toContain("than rent");
    expect(out).toContain("1 of 1 portions");
  });

  it("shows the extra, in the success colour, under the total", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ received: 5480, due: 5450, difference: 30, paidCount: 1 }),
    );
    const out = summary(await render());
    // the total is measured against the rent due, not against what was entered
    expect(out).toContain("₹ 5,480");
    expect(out).toContain("of ₹ 5,450");
    expect(out).toMatch(/<p class="[^"]*text-success-ink[^"]*">₹ 30 more than rent<\/p>/);
    expect(out).not.toContain("text-warn-ink");
    // it comes after the total line and before the progress bar
    expect(out.indexOf("of ₹ 5,450")).toBeLessThan(out.indexOf("more than rent"));
    expect(out.indexOf("more than rent")).toBeLessThan(out.indexOf('role="presentation"'));
  });

  it("shows the shortfall, in the warning colour", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ received: 5449, due: 5450, difference: -1, paidCount: 1 }),
    );
    const out = summary(await render());
    expect(out).toMatch(/<p class="[^"]*text-warn-ink[^"]*">₹ 1 less than rent<\/p>/);
    expect(out).not.toContain("text-success-ink");
    expect(out).not.toMatch(/₹\s*[-−]/);
  });

  describe("when some portions have not paid yet", () => {
    const two = (paidCount: number, difference: number) =>
      view({
        cards: [card(), card({ portionId: "p2", name: "First floor" })],
        received: 5514,
        due: 10900,
        difference,
        paidCount,
      });

    it('says "so far" after the extra, because the total can still change', async () => {
      mocks.loadMonthView.mockResolvedValue(two(1, 64));
      const out = summary(await render());
      expect(out).toMatch(/<p class="[^"]*text-success-ink[^"]*">₹ 64 more than rent so far<\/p>/);
      expect(out).toContain("1 of 2 portions");
    });

    it('says "so far" after the shortfall too, in the warning colour', async () => {
      mocks.loadMonthView.mockResolvedValue(two(1, -3));
      expect(summary(await render())).toMatch(/<p class="[^"]*text-warn-ink[^"]*">₹ 3 less than rent so far<\/p>/);
    });

    it("says nothing when the difference is nil, even though some portions are unpaid", async () => {
      mocks.loadMonthView.mockResolvedValue(two(1, 0));
      expect(summary(await render())).not.toContain("than rent");
    });

    it('does not say "so far" once every portion has paid', async () => {
      mocks.loadMonthView.mockResolvedValue(two(2, 64));
      const out = summary(await render());
      expect(out).toContain("₹ 64 more than rent</p>");
      expect(out).not.toContain("so far");
    });

    it('never says "so far" on a card', async () => {
      const paidCard = card({
        status: "paid",
        entry: { tenant: "Asha", count: 4, amount: 5514 },
        rentReference: 5450,
        rentDifference: 64,
      });
      mocks.loadMonthView.mockResolvedValue(
        view({ cards: [paidCard, card({ portionId: "p2" })], difference: 64, paidCount: 1 }),
      );
      const html = await render();
      expect(html).toContain("₹ 64 more than rent (₹ 5,450)");
      expect(html.match(/so far/g)).toHaveLength(1);
    });
  });

  it("keeps the progress bar at 100% when more than the rent due was received", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ received: 5480, due: 5450, difference: 30, paidCount: 1 }),
    );
    expect(summary(await render())).toContain('style="width:100%"');
  });

  it("fills the progress bar by the share of the rent due that was received", async () => {
    mocks.loadMonthView.mockResolvedValue(view({ received: 2725, due: 5450, paidCount: 0 }));
    expect(summary(await render())).toContain('style="width:50%"');
  });

  it("shows an empty bar when nothing is due", async () => {
    mocks.loadMonthView.mockResolvedValue(view({ received: 0, due: 0, cards: [] }));
    expect(summary(await render())).toContain('style="width:0%"');
  });
});

describe("the month summary: portions that are let", () => {
  const status = (id: string, kind: PortionCard["status"]) => card({ portionId: id, name: id, status: kind });

  it("counts only the portions that are let, and says how many are vacant", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({
        cards: [status("p1", "paid"), status("p2", "paid"), status("p3", "paid"), status("p4", "pending"), status("p5", "vacant")],
        paidCount: 3,
      }),
    );
    const out = summary(await render());
    expect(out).toContain("3 of 4 portions · 1 vacant");
    expect(out).not.toContain("of 5 portions");
  });

  it("counts a portion that never had a tenant as vacant too", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ cards: [status("p1", "paid"), status("p2", "needs-tenant")], paidCount: 1 }),
    );
    expect(summary(await render())).toContain("1 of 1 portions · 1 vacant");
  });

  it('says all portions are vacant when none is let, and never "so far"', async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ cards: [status("p1", "vacant"), status("p2", "vacant")], received: 0, due: 0, difference: 0, paidCount: 0 }),
    );
    const out = summary(await render());
    expect(out).toContain("All portions are vacant");
    expect(out).not.toContain("so far");
  });

  it('says "so far" while a portion that is let has not paid, and not because a portion is vacant', async () => {
    const cards = [status("p1", "paid"), status("p2", "vacant")];
    mocks.loadMonthView.mockResolvedValue(view({ cards, received: 5514, due: 5450, difference: 64, paidCount: 1 }));
    // the only portion that is let has paid: the total cannot change any more
    expect(summary(await render())).toContain("₹\u00a064 more than rent</p>");
    mocks.loadMonthView.mockResolvedValue(
      view({ cards: [...cards, status("p3", "pending")], received: 5514, due: 10900, difference: 64, paidCount: 1 }),
    );
    expect(summary(await render())).toContain("₹\u00a064 more than rent so far</p>");
  });
});

describe("the cards on the home page", () => {
  const paid = (rentDifference: number | null, rentReference: number | null, amount: number) =>
    card({
      status: "paid",
      entry: { tenant: "Asha", count: 4, amount },
      rentDifference,
      rentReference,
    });

  it("shows the extra or short line on a paid card, and nothing else about the rent", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ cards: [paid(30, 5450, 5480)], received: 5480, difference: 30, paidCount: 1 }),
    );
    const html = await render();
    expect(html).toContain("₹ 30 more than rent (₹ 5,450)");
    // once on the card and once in the summary, which has no brackets
    expect(html.match(/more than rent/g)).toHaveLength(2);
  });

  it("shows each card's own difference while extra and short cancel in the summary, which then has no line", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({
        cards: [paid(1, 5450, 5451), paid(-1, 5450, 5449)].map((c, i) => ({ ...c, portionId: `p${i + 1}` })),
        received: 10900,
        due: 10900,
        difference: 0,
        paidCount: 2,
      }),
    );
    const html = await render();
    expect(html).toContain("₹ 1 more than rent (₹ 5,450)");
    expect(html).toContain("₹ 1 less than rent (₹ 5,450)");
    expect(summary(html)).not.toContain("than rent");
  });
});
