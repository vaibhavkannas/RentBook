import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_SCAN_LIMIT, ACTIVITY_SHOWN_LIMIT } from "@/lib/activity-view";
import type { ActivityItem } from "@/lib/sheets/service";
import { CARD, pillClasses } from "@/lib/ui-classes";
import { withoutComments } from "../support/source-scan";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// The Activity page: a diary of the Payments Log. Entries are grouped under the day they were saved on, each says in a
// sentence who did what and for how much, and two rows of chips narrow it by kind of entry and by portion.

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  readActivity: vi.fn(),
  readWrittenAt: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  usePathname: () => "/activity",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
// A link that shows, as attributes, the two props that do not reach the markup: whether it replaces the history entry
// and whether it keeps the scroll position.
vi.mock("next/link", () => ({
  default: ({ href, replace, scroll, children, ...rest }: Record<string, unknown> & { children?: unknown }) =>
    createElement(
      "a",
      { href, "data-replace": String(replace === true), "data-scroll": scroll === false ? "keep" : "top", ...rest },
      children as never,
    ),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ readWrittenAt: mocks.readWrittenAt }));
vi.mock("@/lib/sheets/service", () => ({ readActivity: mocks.readActivity }));

import ActivityPage from "@/app/activity/page";

// 10:30 am on Friday 16 October 2026 in India.
const NOW = new Date("2026-10-16T05:00:00Z");

const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  savedAt: "2026-10-16T04:30:00.000Z",
  month: "2026-10",
  portion: "Ground floor",
  tenant: "Asha",
  amount: 10000,
  count: 4,
  dateReceived: "2026-10-05",
  loggedBy: "owner@example.com",
  action: "Logged",
  ...overrides,
});

async function render(searchParams?: Record<string, string | string[] | undefined>): Promise<string> {
  const page = (await ActivityPage(searchParams ? { searchParams: Promise.resolve(searchParams) } : {})) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

/** Every link in the markup, with its text, address and attributes. */
function links(markup: string) {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, text]) => ({
    text: text.replace(/<[^>]*>/g, ""),
    href: /\shref="([^"]*)"/.exec(attrs)?.[1]?.replaceAll("&amp;", "&"),
    current: /\saria-current="([^"]*)"/.exec(attrs)?.[1],
    replace: /data-replace="([^"]*)"/.exec(attrs)?.[1],
    scroll: /data-scroll="([^"]*)"/.exec(attrs)?.[1],
    attrs,
  }));
}

/** The chips of the row named `label`. */
function chips(markup: string, label: string) {
  const row = new RegExp(`<div role="group" aria-label="${label}"[^>]*>([\\s\\S]*?)</div>`).exec(markup);
  return row ? links(row[1]) : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.readWrittenAt.mockResolvedValue(undefined);
  mocks.readActivity.mockResolvedValue([item()]);
});
afterEach(() => vi.useRealTimers());

describe("the Activity page", () => {
  it("sends a person who is not signed in to the sign-in page", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
  });

  it("has the title Activity as its one h1, and no arrow back, because Activity is a tab", async () => {
    const html = await render();
    expect(html).toContain('<h1 class="text-lg font-semibold">Activity</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain("Back to");
  });

  it("reads the newest 500 rows of the log, no older than the person's own last write", async () => {
    mocks.readWrittenAt.mockResolvedValue(1_800_000_000_000);
    await render();
    expect(mocks.readWrittenAt).toHaveBeenCalledWith("member@example.com");
    expect(mocks.readActivity).toHaveBeenCalledWith(expect.anything(), ACTIVITY_SCAN_LIMIT, { minFetchedAt: 1_800_000_000_000 });
    expect(ACTIVITY_SCAN_LIMIT).toBe(500);
  });

  it("only reads the Payments Log: the one thing it takes from the Sheets service is readActivity", () => {
    const source = withoutComments(readFileSync(new URL("../../src/app/activity/page.tsx", import.meta.url), "utf8"));
    const imports = [...source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"@\/lib\/sheets\/service"/g)];
    expect(imports.length).toBeGreaterThan(0);
    // what is imported as a value: not a whole `import type`, and not a name marked `type`
    const values = imports.flatMap(([, isType, names]) =>
      isType ? [] : names.split(",").map((name) => name.trim()).filter((name) => name && !name.startsWith("type ")),
    );
    expect(values).toEqual(["readActivity"]);
    expect(source).not.toMatch(/\b(?:appendRow|updateValues|logPayment|undoPayment|retryLogRow)\b/);
  });

  describe("the days", () => {
    const rows = () => [
      item({ savedAt: "2026-10-16T04:30:00Z", tenant: "Asha" }),
      item({ savedAt: "2026-10-16T01:00:00Z", tenant: "Bina" }),
      item({ savedAt: "2026-10-15T10:00:00Z", tenant: "Chitra" }),
      item({ savedAt: "2026-10-14T10:00:00Z", tenant: "Dev" }),
      item({ savedAt: "2025-09-01T10:00:00Z", tenant: "Esha" }),
    ];

    it("puts each day under an h2 heading, newest day first: Today, Yesterday, a weekday and date, then a date with its year", async () => {
      mocks.readActivity.mockResolvedValue(rows());
      const html = await render();
      const headings = [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
      expect(headings).toEqual(["Today", "Yesterday", "Wednesday, 14 October", "1 September 2025"]);
    });

    it("draws each heading small and muted and sticky under the top inset, on the page colour so the cards pass under it", async () => {
      mocks.readActivity.mockResolvedValue(rows());
      const html = await render();
      const tag = /<h2\b[^>]*>/.exec(html)![0];
      for (const name of ["sticky", "top-safe", "text-sm", "font-medium", "text-muted", "bg-background"]) {
        expect(tag, name).toMatch(new RegExp(`class="[^"]*\\b${name}\\b`));
      }
    });

    it("follows each heading with an ordered list of cards, so a heading holds only its own day's entries", async () => {
      mocks.readActivity.mockResolvedValue(rows());
      const html = await render();
      const sections = html.split("<section").slice(1);
      expect(sections).toHaveLength(4);
      expect(sections.map((section) => section.match(/<li\b/g)?.length)).toEqual([2, 1, 1, 1]);
      for (const section of sections) {
        expect(section).toMatch(/<\/h2><ol\b/);
        expect(section.match(/<ol\b/g)).toHaveLength(1);
      }
      expect(html.match(new RegExp(`<li class="${CARD}`, "g"))).toHaveLength(5);
    });

    it("keeps the newest-first order inside a day", async () => {
      mocks.readActivity.mockResolvedValue(rows());
      const html = await render();
      expect(html.indexOf("Asha")).toBeLessThan(html.indexOf("Bina"));
      expect(html.indexOf("Bina")).toBeLessThan(html.indexOf("Chitra"));
      expect(html.indexOf("Chitra")).toBeLessThan(html.indexOf("Dev"));
    });

    it("names each section by its heading, for a screen reader", async () => {
      mocks.readActivity.mockResolvedValue(rows());
      const html = await render();
      const ids = [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
      for (const id of ids) expect(html).toMatch(new RegExp(`<h2 id="${id}"`));
    });

    it("puts the days in India time: an entry at 19:00 UTC on the 15th is Today on the 16th", async () => {
      mocks.readActivity.mockResolvedValue([item({ savedAt: "2026-10-15T19:00:00Z" }), item({ savedAt: "2026-10-15T18:00:00Z" })]);
      const headings = [...(await render()).matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
      expect(headings).toEqual(["Today", "Yesterday"]);
    });

    it("puts a row whose time cannot be read last, under Date not recorded", async () => {
      mocks.readActivity.mockResolvedValue([item({ savedAt: "garbage", tenant: "Odd" }), item({ tenant: "Asha" })]);
      const html = await render();
      const headings = [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
      expect(headings).toEqual(["Today", "Date not recorded"]);
      expect(html.indexOf("Asha")).toBeLessThan(html.indexOf("Odd"));
    });
  });

  it("sticks a day's heading just under the notch: top-safe is the top safe-area inset", () => {
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/@utility top-safe \{\s*top: env\(safe-area-inset-top\);\s*\}/);
  });

  it("lets a row of chips run out to the screen's edges: bleed-x-safe takes back the page's gutter and pads itself with it", () => {
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    const rule = /@utility bleed-x-safe \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/margin-left:\s*calc\(-1 \* max\(1rem, env\(safe-area-inset-left\)\)\)/);
    expect(rule).toMatch(/margin-right:\s*calc\(-1 \* max\(1rem, env\(safe-area-inset-right\)\)\)/);
    expect(rule).toMatch(/padding-left:\s*max\(1rem, env\(safe-area-inset-left\)\)/);
    expect(rule).toMatch(/padding-right:\s*max\(1rem, env\(safe-area-inset-right\)\)/);
    expect(rule).toMatch(/scrollbar-width:\s*none/);
    // the gutter it takes back is the page's own (px-safe)
    expect(css).toMatch(/@utility px-safe \{[^}]*padding-left: max\(1rem, env\(safe-area-inset-left\)\)/);
  });

  describe("an entry", () => {
    it("is a card with the portion and the kind of entry as a pill, the sentence, the amount, and when and who", async () => {
      const html = await render();
      expect(html).toContain(`<li class="${CARD}">`);
      expect(html).toMatch(/<p class="[^"]*\bfont-medium\b[^"]*">Ground floor<\/p>/);
      expect(html).toContain(`<span class="${pillClasses("success")}">Logged</span>`);
      expect(html).toContain("Logged ₹ 10,000 from Asha for October 2026 (payment 4).");
      expect(html).toMatch(/<p class="mt-1 text-lg font-medium">₹ 10,000<\/p>/);
      expect(html).toContain("10:00 am · by owner@example.com · received 5 Oct");
    });

    it("says by you for the signed-in person's own entries, and by the address for anyone else's", async () => {
      mocks.readActivity.mockResolvedValue([
        item({ loggedBy: "Member@Example.com", tenant: "Mine" }),
        item({ loggedBy: "owner@example.com", tenant: "Theirs" }),
      ]);
      const html = await render();
      expect(html).toContain("10:00 am · by you · received 5 Oct");
      expect(html).toContain("10:00 am · by owner@example.com · received 5 Oct");
    });

    it("draws the meta line muted, and able to break a long address", async () => {
      expect(await render()).toMatch(/<p class="[^"]*\bbreak-words\b[^"]*\btext-muted\b[^"]*">10:00 am · by owner@example.com/);
    });

    it("says a change as Changed, with an amber pill", async () => {
      mocks.readActivity.mockResolvedValue([item({ action: "Edited", amount: 9500 })]);
      const html = await render();
      expect(html).toContain(`<span class="${pillClasses("warn")}">Changed</span>`);
      expect(html).toContain("Changed Asha&#x27;s October 2026 payment to ₹ 9,500.");
      expect(html).not.toContain(">Edited<");
    });

    it("says an undo as Undone, with a red pill and the amount struck through, and 'removed' for a screen reader", async () => {
      mocks.readActivity.mockResolvedValue([item({ action: "Undone", amount: 10000, dateReceived: "" })]);
      const html = await render();
      expect(html).toContain(`<span class="${pillClasses("danger")}">Undone</span>`);
      expect(html).toContain("Undid Asha&#x27;s October 2026 payment of ₹ 10,000.");
      expect(html).toMatch(
        /<p class="mt-1 text-lg font-medium text-muted line-through"><span class="sr-only">removed <\/span>₹ 10,000<\/p>/,
      );
      expect(html).not.toContain("received");
    });

    it("does not strike or hide the amount of a payment that was logged or changed", async () => {
      mocks.readActivity.mockResolvedValue([item(), item({ action: "Edited" })]);
      const html = await render();
      expect(html).not.toContain("line-through");
      expect(html).not.toContain("removed");
    });

    it("says an older row with no action as Entry, with a neutral pill, and still shows the row", async () => {
      mocks.readActivity.mockResolvedValue([item({ action: null, loggedBy: "" })]);
      const html = await render();
      expect(html).toContain(`<span class="${pillClasses("neutral")}">Entry</span>`);
      expect(html).toContain("₹ 10,000 from Asha for October 2026.");
      expect(html).toContain("10:00 am · who: not recorded");
      expect(html).not.toContain("No action recorded");
    });

    it("leaves out the amount line when the row has no amount", async () => {
      mocks.readActivity.mockResolvedValue([item({ amount: null })]);
      const html = await render();
      expect(html).toContain("Logged from Asha for October 2026 (payment 4).");
      expect(html).not.toContain('<p class="mt-1 text-lg');
    });

    it("writes what is in the Sheet as text, never as markup, and lets a long word break", async () => {
      mocks.readActivity.mockResolvedValue([item({ tenant: "<script>alert(1)</script>", loggedBy: "x".repeat(300) })]);
      const html = await render();
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toMatch(/<p class="mt-1 break-words text-sm">/);
    });
  });

  describe("the filter chips", () => {
    const many = [
      item({ portion: "Ground floor", action: "Logged", tenant: "A" }),
      item({ portion: "First floor", action: "Undone", tenant: "B" }),
      item({ portion: "Ground floor", action: "Edited", tenant: "C" }),
    ];

    it("are two rows: what happened, then which portion, in the order the portions first appear", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render();
      expect(chips(html, "Show").map((chip) => chip.text)).toEqual(["All", "Logged", "Changed", "Undone"]);
      expect(chips(html, "Portion").map((chip) => chip.text)).toEqual(["All portions", "Ground floor", "First floor"]);
      expect(html.indexOf('aria-label="Show"')).toBeLessThan(html.indexOf('aria-label="Portion"'));
    });

    it("sit under the header and above the first day", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render();
      expect(html.indexOf("</header>")).toBeLessThan(html.indexOf('aria-label="Show"'));
      expect(html.indexOf('aria-label="Portion"')).toBeLessThan(html.indexOf("<h2"));
    });

    it("lead to the same screen with that filter, and keep the other filter and the month", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render({ show: "undone", portion: "First floor", month: "2026-10" });
      expect(chips(html, "Show").map((chip) => chip.href)).toEqual([
        "/activity?portion=First+floor&month=2026-10",
        "/activity?show=logged&portion=First+floor&month=2026-10",
        "/activity?show=edited&portion=First+floor&month=2026-10",
        "/activity?show=undone&portion=First+floor&month=2026-10",
      ]);
      expect(chips(html, "Portion").map((chip) => chip.href)).toEqual([
        "/activity?show=undone&month=2026-10",
        "/activity?show=undone&portion=Ground+floor&month=2026-10",
        "/activity?show=undone&portion=First+floor&month=2026-10",
      ]);
    });

    it("have no query at all for everything, with no month and no filters", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render();
      expect(chips(html, "Show")[0].href).toBe("/activity");
      expect(chips(html, "Portion")[0].href).toBe("/activity");
    });

    it("mark the chosen one with aria-current, and only that one", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const none = await render();
      expect(chips(none, "Show").map((chip) => chip.current)).toEqual(["true", undefined, undefined, undefined]);
      expect(chips(none, "Portion").map((chip) => chip.current)).toEqual(["true", undefined, undefined]);
      const chosen = await render({ show: "edited", portion: "First floor" });
      expect(chips(chosen, "Show").map((chip) => chip.current)).toEqual([undefined, undefined, "true", undefined]);
      expect(chips(chosen, "Portion").map((chip) => chip.current)).toEqual([undefined, undefined, "true"]);
    });

    it("draw the chosen chip filled and the others outlined", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render({ show: "logged" });
      const [all, logged] = chips(html, "Show");
      expect(logged.attrs).toContain("bg-accent");
      expect(all.attrs).not.toContain("bg-accent");
      expect(all.attrs).toContain("border-control");
    });

    it("replace the history entry and keep the scroll position, so a filter is not a page to go back through", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render();
      for (const chip of [...chips(html, "Show"), ...chips(html, "Portion")]) {
        expect(chip.replace, chip.text).toBe("true");
        expect(chip.scroll, chip.text).toBe("keep");
      }
    });

    it("are 44 px tall at least, answer a press, and scroll sideways when they do not fit", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render();
      const row = chips(html, "Portion");
      expect(row).toHaveLength(3);
      expect(smallTargets(html)).toEqual([]);
      expect(unpressedTargets(html)).toEqual([]);
      expect(html).toMatch(/<div role="group" aria-label="Portion" class="[^"]*\boverflow-x-auto\b/);
      for (const chip of row) expect(chip.attrs).toMatch(/class="[^"]*\bshrink-0\b[^"]*\bwhitespace-nowrap\b/);
    });

    it("count the portions of the whole scan, not only of the entries that the other filter keeps", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const html = await render({ show: "undone" });
      expect(chips(html, "Portion").map((chip) => chip.text)).toEqual(["All portions", "Ground floor", "First floor"]);
    });

    it("filter the entries: a kind of entry, a portion, or both", async () => {
      mocks.readActivity.mockResolvedValue(many);
      const shown = async (params: Record<string, string>) => (await render(params)).match(/<li\b/g)?.length ?? 0;
      expect(await shown({})).toBe(3);
      expect(await shown({ show: "undone" })).toBe(1);
      expect(await shown({ portion: "Ground floor" })).toBe(2);
      expect(await shown({ show: "logged", portion: "Ground floor" })).toBe(1);
      expect(await shown({ show: "undone", portion: "Ground floor" })).toBe(0);
      expect(await shown({ show: "not-a-kind", portion: "" })).toBe(3);
    });
  });

  describe("when there is nothing to show", () => {
    it("says Nothing logged yet, and what will show up, when the log has no rows, with no chips", async () => {
      mocks.readActivity.mockResolvedValue([]);
      const html = await render();
      expect(html).toContain("Nothing logged yet");
      expect(html).toContain("Payments you log, change or undo show up here, newest first.");
      expect(html).not.toContain("role=\"group\"");
      expect(html).not.toContain("<h2");
      expect(html).not.toContain("<li");
    });

    it("says no entries match when the filters keep nothing, keeps the chips, and offers Show everything", async () => {
      mocks.readActivity.mockResolvedValue([item({ action: "Logged" })]);
      const html = await render({ show: "undone", month: "2026-10" });
      expect(html).toContain("No entries match these filters.");
      expect(html).not.toContain("Nothing logged yet");
      expect(html).not.toContain("<li");
      expect(chips(html, "Show")).toHaveLength(4);
      const everything = links(html).find((link) => link.text === "Show everything");
      expect(everything).toMatchObject({ href: "/activity?month=2026-10", replace: "true", scroll: "keep" });
      expect(smallTargets(html)).toEqual([]);
    });

    it("offers Show everything with no month when there is none", async () => {
      mocks.readActivity.mockResolvedValue([item()]);
      const html = await render({ portion: "Nowhere" });
      expect(links(html).find((link) => link.text === "Show everything")?.href).toBe("/activity");
    });

    it("does not offer Show everything when entries are showing", async () => {
      expect(await render({ show: "logged" })).not.toContain("Show everything");
    });
  });

  describe("a long log", () => {
    const log = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        item({ savedAt: new Date(NOW.getTime() - index * 3_600_000).toISOString(), tenant: `Tenant ${index}` }),
      );
    const NOTE = "Showing the newest 50. Older entries are in the Payments Log tab of your Sheet.";

    it("shows the newest 50 and says so, with where the older ones are", async () => {
      mocks.readActivity.mockResolvedValue(log(51));
      const html = await render();
      expect(html.match(/<li\b/g)).toHaveLength(ACTIVITY_SHOWN_LIMIT);
      expect(html).toContain("Tenant 0");
      expect(html).toContain("Tenant 49");
      expect(html).not.toContain("Tenant 50");
      expect(html).toContain(NOTE);
      expect(html).toMatch(/<p class="[^"]*text-muted[^"]*">Showing the newest 50\./);
      expect(ACTIVITY_SHOWN_LIMIT).toBe(50);
    });

    it("says nothing of the sort when 50 or fewer match", async () => {
      mocks.readActivity.mockResolvedValue(log(50));
      const html = await render();
      expect(html.match(/<li\b/g)).toHaveLength(50);
      expect(html).not.toContain("Showing the newest");
    });

    it("counts the entries that match the filters, not the whole log", async () => {
      const rows = log(120).map((row, index) => ({ ...row, action: index % 2 === 0 ? ("Logged" as const) : ("Undone" as const) }));
      mocks.readActivity.mockResolvedValue(rows);
      const some = await render({ show: "undone" });
      expect(some.match(/<li\b/g)).toHaveLength(50);
      expect(some).toContain(NOTE);
      mocks.readActivity.mockResolvedValue(rows.slice(0, 80));
      const few = await render({ show: "undone" });
      expect(few.match(/<li\b/g)).toHaveLength(40);
      expect(few).not.toContain("Showing the newest");
    });

    it("copes with a full scan of 500 rows over many days", async () => {
      mocks.readActivity.mockResolvedValue(
        Array.from({ length: ACTIVITY_SCAN_LIMIT }, (_, index) =>
          item({ savedAt: new Date(NOW.getTime() - index * 5 * 3_600_000).toISOString(), portion: `Portion ${index % 7}` }),
        ),
      );
      const html = await render();
      expect(html.match(/<li\b/g)).toHaveLength(50);
      expect(chips(html, "Portion")).toHaveLength(8);
      expect(html).toContain("Showing the newest 50.");
    });
  });

  describe("when the Payments Log cannot be read", () => {
    it("shows the problem block, and no chips or days", async () => {
      mocks.readActivity.mockRejectedValue(new Error("down"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const html = await render();
      log.mockRestore();
      expect(html).toContain('role="alert"');
      expect(html).toContain("Can&#x27;t load your Sheet");
      expect(html).not.toContain("<h2");
      expect(html).not.toContain("Nothing logged yet");
    });

    it("keeps the filters and the month in its Try again link", async () => {
      mocks.readActivity.mockRejectedValue(new Error("down"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const retry = async (params?: Record<string, string>) =>
        links(await render(params)).find((link) => link.text === "Try again")?.href;
      expect(await retry({ month: "2026-10" })).toBe("/activity?month=2026-10");
      expect(await retry()).toBe("/activity");
      expect(await retry({ month: "garbage" })).toBe("/activity");
      expect(await retry({ show: "undone", month: "2026-10" })).toBe("/activity?show=undone&month=2026-10");
      expect(await retry({ show: "logged", portion: "First floor", month: "2026-10" })).toBe(
        "/activity?show=logged&portion=First+floor&month=2026-10",
      );
      expect(await retry({ show: "nonsense" })).toBe("/activity");
      log.mockRestore();
    });
  });

  describe("for a thumb", () => {
    it.each([
      ["entries", [item(), item({ action: "Undone" }), item({ action: "Edited" }), item({ action: null })], {}],
      ["a filter that matches nothing", [item()], { show: "undone" }],
      ["an empty log", [], {}],
    ] as const)("%s: every button and link is 44 px tall and answers a press", async (_name, rows, params) => {
      mocks.readActivity.mockResolvedValue([...rows]);
      const html = await render(params);
      expect(smallTargets(html)).toEqual([]);
      expect(unpressedTargets(html)).toEqual([]);
    });
  });
});
