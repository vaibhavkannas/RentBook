import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthView, PortionCard } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";

// A smoke test of the home page: the month summary and the cards, with the data layer replaced. The
// client components render their first (server) output only.

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  loadMonthView: vi.fn(),
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
vi.mock("@/lib/server/freshness", () => ({ loadMonthView: mocks.loadMonthView }));

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
    expect(out).toContain("₹ 5,450");
    expect(out).toContain("of ₹ 5,450");
    expect(out).not.toContain("than rent");
    expect(out).toContain("1 of 1 portions");
  });

  it("shows the extra, in the success colour, under the total", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ received: 5480, due: 5450, difference: 30, paidCount: 1 }),
    );
    const out = summary(await render());
    // the total is measured against the rent due, not against what was entered
    expect(out).toContain("₹ 5,480");
    expect(out).toContain("of ₹ 5,450");
    expect(out).toMatch(/<p class="[^"]*text-success-ink[^"]*">₹ 30 more than rent<\/p>/);
    expect(out).not.toContain("text-warn-ink");
    // it comes after the total line and before the progress bar
    expect(out.indexOf("of ₹ 5,450")).toBeLessThan(out.indexOf("more than rent"));
    expect(out.indexOf("more than rent")).toBeLessThan(out.indexOf('role="presentation"'));
  });

  it("shows the shortfall, in the warning colour", async () => {
    mocks.loadMonthView.mockResolvedValue(
      view({ received: 5449, due: 5450, difference: -1, paidCount: 1 }),
    );
    const out = summary(await render());
    expect(out).toMatch(/<p class="[^"]*text-warn-ink[^"]*">₹ 1 less than rent<\/p>/);
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
      expect(out).toMatch(/<p class="[^"]*text-success-ink[^"]*">₹ 64 more than rent so far<\/p>/);
      expect(out).toContain("1 of 2 portions");
    });

    it('says "so far" after the shortfall too, in the warning colour', async () => {
      mocks.loadMonthView.mockResolvedValue(two(1, -3));
      expect(summary(await render())).toMatch(/<p class="[^"]*text-warn-ink[^"]*">₹ 3 less than rent so far<\/p>/);
    });

    it("says nothing when the difference is nil, even though some portions are unpaid", async () => {
      mocks.loadMonthView.mockResolvedValue(two(1, 0));
      expect(summary(await render())).not.toContain("than rent");
    });

    it('does not say "so far" once every portion has paid', async () => {
      mocks.loadMonthView.mockResolvedValue(two(2, 64));
      const out = summary(await render());
      expect(out).toContain("₹ 64 more than rent</p>");
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
      expect(html).toContain("₹ 64 more than rent (₹ 5,450)");
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
    expect(html).toContain("₹ 30 more than rent (₹ 5,450)");
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
    expect(html).toContain("₹ 1 more than rent (₹ 5,450)");
    expect(html).toContain("₹ 1 less than rent (₹ 5,450)");
    expect(summary(html)).not.toContain("than rent");
  });
});
