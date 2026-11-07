import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import type { ScheduleRow } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";
import { formatRupees } from "@/lib/format";
import { AGREEMENT_HINT, ALERTS_FOOTNOTE, HIKE_MOVED_OUT_HINT, NO_AGREEMENTS_TEXT, NO_HIKES_TEXT } from "@/lib/report-copy";
import { CARD, noticeClasses, pillClasses } from "@/lib/ui-classes";
import { baseRows, parsedRows, PORTIONS, tenancyRow } from "../support/fixtures";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// The Agreements and hikes screen: agreements that have ended or end soon, and rent hikes that are due or coming, from the one
// snapshot the month screen reads, with the data layer replaced. The arrow back is a client component; here it renders its
// first (server) output only.

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
  usePathname: () => "/alerts",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ loadPageSnapshot: mocks.loadPageSnapshot }));

import AlertsPage from "@/app/alerts/page";

/** 17 October 2026, noon in India. */
const NOW = new Date("2026-10-17T06:30:00Z");

type SnapshotOptions = { rows?: ScheduleRow[]; tenancies?: Tenancy[]; tenantsProblem?: string };

const snapshot = ({ rows = baseRows(), tenancies = [], tenantsProblem }: SnapshotOptions = {}) => ({
  portions: PORTIONS,
  rows,
  tenancies,
  tenantsProblem,
});

/** One agreement that ended 12 days ago (Asha), one that ends today (Esha) and one that ends in 30 days (Chitra). */
const AGREEMENTS = [
  tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2026-10-05" }),
  tenancyRow({ id: "t-3", portionId: "p3", tenant: "Chitra", agreementEnd: "2026-11-16" }),
  tenancyRow({ id: "t-5", portionId: "p5", tenant: "Esha", agreementEnd: "2026-10-17" }),
];

/** September ended with Asha on payment 9 of 11 and Bala on 11 of 11: Bala's hike is due, Asha's is for December. */
const HIKES_ROWS = () =>
  parsedRows(
    [2026, 8, [["Asha", 8, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000]]],
    [2026, 9, [["Asha", 9, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], null, ["Esha", 1, 5100]]],
  );

async function render(searchParams: Record<string, string | string[] | undefined> = {}): Promise<string> {
  const page = (await AlertsPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement;
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

/** One section of the page, by its id. */
const section = (html: string, id: string) =>
  new RegExp(`<section id="${id}"[^>]*>[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";

/** The cards of a section, in the order they are drawn. */
const cards = (part: string) => part.split(`<li class="${CARD}">`).slice(1).map((card) => card.split("</li>")[0]);

const headingsIn = (part: string) => [...part.matchAll(/<h3 class="[^"]*">([^<]*)<\/h3>/g)].map((match) => match[1]);

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: HIKES_ROWS(), tenancies: AGREEMENTS }));
});
afterEach(() => vi.useRealTimers());

describe("the Agreements and hikes page", () => {
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

  it("is titled Agreements and hikes, with an arrow back to the month that was showing", async () => {
    nav.search = "month=2026-08";
    const html = await render({ month: "2026-08" });
    expect(html).toContain('<h1 class="min-w-0 break-words text-lg font-semibold">Agreements and hikes</h1>');
    expect(html).toMatch(/<a [^>]*aria-label="Back to month"[^>]*href="\/\?month=2026-08"[^>]*>‹<\/a>/);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("makes room for the tab bar", async () => {
    expect(await render()).toMatch(/^<main class="[^"]*\bpb-tabbar\b/);
  });

  it("has the two sections, Agreements and then Rent hikes, each with an address the home card can link to", async () => {
    const html = await render();
    expect(html).toMatch(/<section id="agreements"[^>]*>/);
    expect(html).toMatch(/<section id="hikes"[^>]*>/);
    expect(html).toMatch(/<h2 [^>]*>Agreements<\/h2>/);
    expect(html).toMatch(/<h2 [^>]*>Rent hikes<\/h2>/);
    expect(html.indexOf('id="agreements"')).toBeLessThan(html.indexOf('id="hikes"'));
  });

  it("ends with the footnote about where a hike comes from and that the app sends no reminders", async () => {
    const html = await render();
    expect(visibleText(html)).toContain(ALERTS_FOOTNOTE);
    expect(html).toContain(`<p class="mt-4 text-sm text-muted">${ALERTS_FOOTNOTE}</p>`);
    expect(html.indexOf(ALERTS_FOOTNOTE)).toBeGreaterThan(html.indexOf('id="hikes"'));
  });
});

describe("the Agreements section: one ended, one that ends today, one that ends soon", () => {
  const agreements = async (searchParams = {}) => section(await render(searchParams), "agreements");

  it("draws a card for each, the ended first, then today, then the soonest", async () => {
    const part = await agreements();
    expect(headingsIn(part)).toEqual(["First floor, single bedroom", "Third floor, hall and kitchen", "Second floor, single bedroom"]);
    expect(cards(part)).toHaveLength(3);
  });

  it("says Ended in the danger tone, Ends today and the days left in the warn tone", async () => {
    const [ended, today, soon] = cards(await agreements());
    expect(ended).toContain(`<span class="${pillClasses("danger")}">Ended</span>`);
    expect(today).toContain(`<span class="${pillClasses("warn")}">Ends today</span>`);
    expect(soon).toContain(`<span class="${pillClasses("warn")}">30 days left</span>`);
  });

  it("names the tenant, muted, and says what the agreement does, with its date", async () => {
    const [ended, today, soon] = cards(await agreements());
    expect(ended).toContain('<p class="mt-0.5 break-words text-sm text-muted">Asha</p>');
    expect(visibleText(ended)).toContain("Agreement ended 12 days ago, on 5 Oct 2026.");
    expect(visibleText(today)).toContain("Agreement ends today.");
    expect(visibleText(soon)).toContain("Agreement ends in 30 days, on 16 Nov 2026.");
  });

  it("tells the owner of an ended agreement what to do when the tenant stayed on, and no other card", async () => {
    const [ended, today, soon] = cards(await agreements());
    expect(visibleText(ended)).toContain(AGREEMENT_HINT);
    expect(today).not.toContain(AGREEMENT_HINT);
    expect(soon).not.toContain(AGREEMENT_HINT);
  });

  it("links each card to the tenant's details, keeping the month, as a 44 px link", async () => {
    const [ended, , soon] = cards(await agreements({ month: "2026-10" }));
    const link = /<a [^>]*href="\/tenants\/p1\?month=2026-10"[^>]*>([\s\S]*?)<\/a>/.exec(ended);
    expect(link?.[1]).toBe("Details");
    expect(link?.[0]).toContain('aria-label="Details for First floor, single bedroom"');
    expect(link?.[0]).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(soon).toContain('href="/tenants/p3?month=2026-10"');
    expect(soon).toContain('aria-label="Details for Second floor, single bedroom"');
  });

  it("links to the tenant page with no month when the address has none", async () => {
    const [ended] = cards(await agreements());
    expect(ended).toContain('href="/tenants/p1"');
  });

  it("says the Agreements section has nothing when no agreement is within 60 days, and draws no card", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(
      snapshot({ rows: HIKES_ROWS(), tenancies: [tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2027-03-15" })] }),
    );
    const part = section(await render(), "agreements");
    expect(part).toContain(`<p class="mt-2 text-sm text-muted">${NO_AGREEMENTS_TEXT}</p>`);
    expect(cards(part)).toHaveLength(0);
    expect(NO_AGREEMENTS_TEXT).toBe("No agreement ends in the next 60 days.");
  });
});

describe("the Rent hikes section: one due, one coming", () => {
  const hikes = async (searchParams = {}) => section(await render(searchParams), "hikes");

  it("draws a card for each, the earlier hike first, each with its portion", async () => {
    const part = await hikes();
    expect(headingsIn(part)).toEqual(["First floor, double bedroom", "First floor, single bedroom"]);
    expect(cards(part)).toHaveLength(2);
  });

  it("says Next payment in the warn tone for the one that is due, and the month in the neutral tone for the other", async () => {
    const [due, soon] = cards(await hikes());
    expect(due).toContain(`<span class="${pillClasses("warn")}">Next payment</span>`);
    expect(soon).toContain(`<span class="${pillClasses("neutral")}">December 2026</span>`);
  });

  it("says who, when the rent goes up and from what to what", async () => {
    const [due, soon] = cards(await hikes());
    expect(due).toContain('<p class="mt-0.5 break-words text-sm text-muted">Bala</p>');
    expect(visibleText(due)).toContain(
      `Rent goes up 5% with the next payment (October 2026): ${formatRupees(12700)} to ${formatRupees(13335)}.`,
    );
    expect(visibleText(soon)).toContain(
      `Rent goes up 5% from the payment for December 2026, after 2 more payments: ${formatRupees(5450)} to ${formatRupees(5723)}.`,
    );
  });

  it("says the Rent hikes section has nothing when no hike is within 2 months, and draws no card", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: parsedRows([2026, 9, [["Asha", 3, 5450]]]), tenancies: AGREEMENTS }));
    const part = section(await render(), "hikes");
    expect(part).toContain(`<p class="mt-2 text-sm text-muted">${NO_HIKES_TEXT}</p>`);
    expect(cards(part)).toHaveLength(0);
    expect(NO_HIKES_TEXT).toBe("No rent hike in the next 2 months.");
  });

  it("asks whether the tenant moved out when a hike has been due for more than three months, and not for a recent one", async () => {
    expect(visibleText(await hikes())).not.toContain(HIKE_MOVED_OUT_HINT);
    // Bala's last payment was April's 11th of 11: that hike has been due since June
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: parsedRows([2026, 4, [null, ["Bala", 11, 12700]]]), tenancies: [] }));
    const stale = cards(await hikes());
    expect(stale).toHaveLength(1);
    expect(visibleText(stale[0])).toContain(HIKE_MOVED_OUT_HINT);
  });
});

describe("a quiet Sheet", () => {
  beforeEach(() => mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: parsedRows([2026, 9, [["Asha", 3, 5450]]]) })));

  it("says each section has nothing, in its own line, with the footnote under them", async () => {
    const html = await render();
    expect(section(html, "agreements")).toContain(NO_AGREEMENTS_TEXT);
    expect(section(html, "hikes")).toContain(NO_HIKES_TEXT);
    expect(visibleText(html)).toContain(ALERTS_FOOTNOTE);
    expect(html).not.toContain(`<li class="${CARD}">`);
  });
});

describe("the Agreements and hikes page when the Tenants tab cannot be read", () => {
  beforeEach(() =>
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: HIKES_ROWS(), tenantsProblem: "The Tenants tab has no Phone header." })),
  );

  it("says agreements cannot be checked, in place of cards or an all-clear", async () => {
    const part = section(await render(), "agreements");
    expect(part).toContain(`<p class="${noticeClasses("warn")} mt-2">`);
    expect(visibleText(part)).toContain("The Tenants tab can't be read, so agreements can't be checked. The Tenants tab has no Phone header.");
    expect(part).not.toContain(NO_AGREEMENTS_TEXT);
    expect(cards(part)).toHaveLength(0);
  });

  it("still lists the hikes, which come from the Schedule, under a warning that one may be for a tenant who left", async () => {
    const part = section(await render(), "hikes");
    expect(cards(part)).toHaveLength(2);
    expect(part).toContain(`<p class="${noticeClasses("warn")} mt-2">`);
    expect(visibleText(part)).toContain(
      "The Tenants tab can't be read, so a hike below may be for a tenant who has moved out. The Tenants tab has no Phone header.",
    );
  });

  it("shows no warning when the Tenants tab is fine", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: HIKES_ROWS(), tenancies: AGREEMENTS }));
    expect(visibleText(await render())).not.toContain("Tenants tab can't be read");
    expect(section(await render(), "hikes")).not.toContain(noticeClasses("warn"));
  });
});

describe("the Agreements and hikes page when the Sheet cannot be read", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadPageSnapshot.mockRejectedValue(new AppError("sheet-structure", "The Schedule tab has no Month header."));
  });
  afterEach(() => log.mockRestore());

  it("explains the problem in place of the sections, with Try again for the same month", async () => {
    const html = await render({ month: "2026-08" });
    expect(html).toContain("The Schedule tab has no Month header.");
    expect(html).toMatch(/<a [^>]*href="\/alerts\?month=2026-08"[^>]*>Try again<\/a>/);
    expect(html).not.toContain('id="agreements"');
    expect(html).not.toContain('id="hikes"');
    expect(html).not.toContain(ALERTS_FOOTNOTE);
  });

  it("keeps the header and the way back", async () => {
    const html = await render();
    expect(html).toContain("Agreements and hikes</h1>");
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
  it("gives every link of the page a 44 px target that answers a press", async () => {
    const html = await render({ month: "2026-10" });
    expect(smallTargets(html)).toEqual([]);
    expect(unpressedTargets(html)).toEqual([]);
  });

  it("does so for a quiet Sheet and for the problem block too", async () => {
    mocks.loadPageSnapshot.mockResolvedValue(snapshot({ rows: parsedRows([2026, 9, [["Asha", 3, 5450]]]) }));
    const quiet = await render();
    expect(smallTargets(quiet)).toEqual([]);
    expect(unpressedTargets(quiet)).toEqual([]);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    mocks.loadPageSnapshot.mockRejectedValue(new AppError("config", "The key is wrong."));
    const problem = await render();
    log.mockRestore();
    expect(problem).toContain("Open Set up");
    expect(smallTargets(problem)).toEqual([]);
    expect(unpressedTargets(problem)).toEqual([]);
  });

  it("names each section by its heading for a screen reader", async () => {
    const html = await render();
    expect(html).toMatch(/<section id="agreements" aria-labelledby="agreements-heading"/);
    expect(html).toContain('<h2 id="agreements-heading"');
    expect(html).toMatch(/<section id="hikes" aria-labelledby="hikes-heading"/);
    expect(html).toContain('<h2 id="hikes-heading"');
  });
});
