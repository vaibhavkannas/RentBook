import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summaryText } from "@/lib/month-summary";
import { CONNECTION_NEEDS_ATTENTION } from "@/lib/errors";
import { getMonthView } from "@/lib/sheets/service";
import { pillClasses } from "@/lib/ui-classes";
import { inside, link, named, pageText, textOf } from "../support/html";
import { captureLogs, type LogSpies } from "../support/logs";
import { expectSound as sound, FIXED_NOW, MEMBER, OWNER, renderScreen, screenContext } from "../support/screens";
import { faults, LONG_PORTION, LONG_TENANT, world, type Faults, type Tabs } from "../support/worlds";
import { wrapProblems } from "../support/wrapping";

// The core screens (the month screen, Activity, More, Portion settings, a tenant's page, and the sign-in, error and not-found
// pages), each rendered as the real page through the real data path against the in-memory Sheet of a world, in its main
// states. Every render must pass the landmark rules and have no control too small for a thumb and no secret in it.

// The mock block of tests/support/screens.ts, copied.
import type { Viewer } from "@/lib/server/auth-guard";
import type { SheetsContext } from "@/lib/sheets/service";

const h = vi.hoisted(() => ({
  viewer: null as Viewer | null, // who getViewer() answers: null is a person who is not signed in
  ctx: (() => {
    throw new Error("The test gave the page no Sheet.");
  }) as () => SheetsContext, // what the page's getSheetsContext() answers
  path: "/", // what usePathname() answers
  search: "", // what useSearchParams() answers, as a query string
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({ refresh() {}, back() {}, replace() {}, push() {} }),
  usePathname: () => h.path,
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set() {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: async () => h.viewer }));
vi.mock("@/lib/server/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/context")>()),
  getSheetsContext: () => h.ctx(),
}));
// The not-found page waits for a request, which there is none here.
vi.mock("next/server", () => ({ connection: async () => {} }));

import ActivityPage from "@/app/activity/page";
import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";
import Home from "@/app/(month)/page";
import MorePage from "@/app/more/page";
import NotFound from "@/app/not-found";
import SettingsPage from "@/app/settings/page";
import SignInPage from "@/app/signin/page";
import TenantPage from "@/app/tenants/[portionId]/page";

let logs: LogSpies;

beforeEach(() => {
  logs = captureLogs();
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  h.viewer = OWNER;
  h.path = "/";
  h.search = "";
  useSheet("main");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The Sheet the page reads: a world, or tabs a test made. The fake is returned for a test that wants to look at it. */
function useSheet(source: Parameters<typeof screenContext>[0], options: { faults?: Faults } = {}) {
  const sheet = screenContext(source, options);
  h.ctx = () => sheet.ctx;
  return sheet;
}

const month = async (search: { month?: string } = {}) => sound(renderScreen(await Home({ searchParams: Promise.resolve(search) })));
const activity = async (search: Record<string, string | string[] | undefined> = {}) =>
  sound(renderScreen(await ActivityPage({ searchParams: Promise.resolve(search) })));
const more = async (search: Record<string, string | string[] | undefined> = {}) =>
  sound(renderScreen(await MorePage({ searchParams: Promise.resolve(search) })));
const settings = async (search: Record<string, string | string[] | undefined> = {}) =>
  sound(renderScreen(await SettingsPage({ searchParams: Promise.resolve(search) })));
const tenant = async (portionId: string, search: Record<string, string | string[] | undefined> = {}) =>
  sound(renderScreen(await TenantPage({ params: Promise.resolve({ portionId }), searchParams: Promise.resolve(search) })));

/** The month screen's cards: each one's name and everything it says. */
function cards(html: string) {
  return named(html, "li")
    .filter((row) => inside(row, "h2").length > 0)
    .map((row) => ({ name: textOf(inside(row, "h2")[0]), text: textOf(row) }));
}

/** The text of one section of a page, named by its heading's id or its aria-label. */
function section(html: string, label: string): string {
  const found = named(html, "section").find((element) => element.attrs["aria-label"] === label);
  expect(found, `a section "${label}"`).toBeDefined();
  return textOf(found!);
}

describe("the month screen", () => {
  it("shows the five portions in Settings order, in the states of the world", async () => {
    const html = await month();
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["October 2026"]);
    const shown = cards(html).map((card) => card.text);
    expect(shown).toHaveLength(5);
    expect(shown[0]).toMatch(/^First floor, single bedroom Asha · Payment 4 of 11 ₹ 5,450 Paid /);
    // The chips of the tenancy: the advance, and the agreement that ends in 30 days (for p3, one that ended a week ago).
    expect(shown[0]).toContain("Advance ₹ 10,900 held Agreement ends 16 Nov 2026");
    expect(shown[0]).toMatch(/Edit amount Undo Details$/);
    expect(shown[1]).toMatch(/^First floor, double bedroom Bala · Payment 1 of 11 ₹ 13,335 Overdue /);
    expect(shown[1]).toContain("₹ 13,335");
    expect(shown[1]).toContain("New cycle. Suggested rent includes the hike (was ₹ 12,700).");
    expect(shown[1]).toMatch(/Log payment Details$/);
    expect(shown[2]).toMatch(/^Second floor, single bedroom Chitra · Payment 5 of 11 ₹ 9,000 Overdue /);
    expect(shown[2]).toContain("Advance ₹ 18,000 held Agreement ended 10 Oct 2026");
    expect(shown[3]).toMatch(/^Second floor, double bedroom No tenant recorded yet\. Vacant Add tenant$/);
    expect(shown[4]).toMatch(/^Third floor, hall and kitchen Vacant since 1 Oct 2026\. Esha moved out\. Vacant Add tenant Past tenants$/);
  });

  it("keeps suggesting the true rent after an amount agreed for one month: Bala paid 12,000 for payment 11, and the hike is still worked from 12,700", async () => {
    const tabs = world("main", FIXED_NOW).tabs;
    tabs.Schedule[4][6] = 12000; // p2's amount in the row of last month
    useSheet(tabs);
    const shown = cards(await month()).map((card) => card.text);
    expect(shown[1]).toContain("₹ 13,335");
    expect(shown[1]).toContain("New cycle. Suggested rent includes the hike (was ₹ 12,700).");
    // last month's card still says how the agreed amount compares with the rent, and nothing else changed
    const last = cards(await month({ month: "2026-09" })).map((card) => card.text);
    expect(last[1]).toContain("Compared with rent ₹ 700 less than rent (₹ 12,700)");
  });

  it("colours each card's pill by its state, not only by its words", async () => {
    const html = await month();
    expect(html.match(new RegExp(`<span class="${pillClasses("success")}">Paid</span>`, "g"))).toHaveLength(1);
    // 17 October: the rent of October has counted as overdue since the 6th, so the two cards with no payment are red
    expect(html.match(new RegExp(`<span class="${pillClasses("danger")}">Overdue</span>`, "g"))).toHaveLength(2);
    expect(html).not.toContain(">Pending</span>");
    expect(html.match(new RegExp(`<span class="${pillClasses("neutral")}">Vacant</span>`, "g"))).toHaveLength(2);
  });

  it("sums the month in a summary that says what summaryText says", async () => {
    const view = await getMonthView(screenContext("main").ctx, { year: 2026, month: 10 });
    const html = await month();
    expect(summaryText(view)).toBe("1 of 3 portions paid · 2 vacant");
    const text = section(html, "Month summary");
    expect(text).toContain(summaryText(view));
    expect(text).toContain("₹ 5,450 of ₹ 27,785");
    expect(text).toContain("Year at a glance");
  });

  it("opens on this month, and says what needs attention under it", async () => {
    const text = section(await month(), "Needs attention");
    expect(text).toBe("Needs attention Rent overdue: 2 portions, ₹ 31,335 1 agreement ended 1 agreement ends within 60 days Rent goes up soon for 1 portion");
  });

  it("shows another month from ?month: September 2026, with a This month button and no one else's rent on it", async () => {
    const html = await month({ month: "2026-09" });
    expect(textOf(named(html, "h1")[0])).toBe("September 2026");
    expect(named(html, "button").map((button) => textOf(button))).toContain("This month");
    const shown = cards(html).map((card) => card.text);
    expect(shown[0]).toMatch(/^First floor, single bedroom Asha · Payment 3 of 11 ₹ 5,450 Paid /);
    expect(shown[0]).toContain("Later months have entries for this portion. Undo those first.");
    expect(shown[1]).toMatch(/^First floor, double bedroom Bala · Payment 11 of 11 /);
    expect(shown[1]).toContain("Last payment of this cycle.");
    expect(shown[2]).toMatch(/^Second floor, single bedroom Chitra/);
    expect(shown[3]).toMatch(/^Second floor, double bedroom No tenant recorded yet\. Vacant/);
    expect(shown[4]).toMatch(/^Third floor, hall and kitchen Esha · Payment 2 of 11 /);
    expect(link(html, "Year at a glance")?.attrs.href).toBe("/year?year=2026&month=2026-09");
    expect(html).not.toContain("Needs attention");
  });

  it("shows the empty world as five vacant portions and nothing received", async () => {
    useSheet("empty");
    const html = await month();
    expect(cards(html).map((card) => card.text)).toEqual(
      [
        "First floor, single bedroom",
        "First floor, double bedroom",
        "Second floor, single bedroom",
        "Second floor, double bedroom",
        "Third floor, hall and kitchen",
      ].map((name) => `${name} No tenant recorded yet. Vacant Add tenant`),
    );
    const text = section(html, "Month summary");
    expect(text).toContain("All portions are vacant");
    expect(text).toContain("₹ 0 of ₹ 0");
    expect(html).not.toContain("Needs attention");
  });

  it("refuses a Schedule that has its header and no month row at all, in words the owner can act on, with a way to Set up", async () => {
    const tabs = world("empty", FIXED_NOW).tabs;
    tabs.Schedule = tabs.Schedule.slice(0, 3);
    useSheet(tabs);
    const html = await month();
    expect(pageText(html)).toContain("Can't load your Sheet The Schedule tab has no month rows yet. Type this month's row, with each portion's tenant, count and amount, then try again.");
    expect(link(html, "Open Set up to see what is wrong")?.attrs.href).toBe("/setup?month=2026-10");
    expect(html).not.toContain("Month summary");
  });

  describe("when the Sheet cannot be read", () => {
    it("says so, names Google, and keeps the month in Try again", async () => {
      useSheet("main", { faults: faults({ getManyValues: "unavailable" }) });
      const html = await month({ month: "2026-09" });
      expect(named(html, "div").find((element) => element.attrs.role === "alert")).toBeDefined();
      expect(pageText(html)).toContain("Can't load your Sheet Google isn't responding. Try again in a minute. Try again");
      expect(link(html, "Try again")?.attrs.href).toBe("/?month=2026-09");
      expect(link(html, "Open Set up to see what is wrong")).toBeUndefined();
      expect(html).not.toContain("Month summary");
      expect(cards(html)).toEqual([]);
    });

    it("tells Google's own limit, in its words", async () => {
      useSheet("main", { faults: faults({ getManyValues: "rate-limited" }) });
      expect(pageText(await month())).toContain("Google is limiting requests right now. Wait a minute and try again.");
    });

    it("keeps what went wrong inside from the screen: a plain error is Couldn't reach Google Sheets, and its text goes to the log", async () => {
      useSheet("main", { faults: faults({ getManyValues: "error" }) });
      const html = await month();
      expect(pageText(html)).toContain("Couldn't reach Google Sheets. Try again.");
      expect(html).not.toContain("on purpose");
      expect(logs.error).toHaveBeenCalled();
    });

    it("gives the owner a way to Set up when the connection is wrong, and the details", async () => {
      useSheet("main", { faults: faults({ getManyValues: "config" }) });
      const html = await month();
      expect(pageText(html)).toContain("Google could not find that Sheet. Check SHEET_ID.");
      expect(link(html, "Open Set up to see what is wrong")?.attrs.href).toBe("/setup?month=2026-10");
    });

    it("tells a member only to ask the owner, with no way to Set up", async () => {
      h.viewer = MEMBER;
      useSheet("main", { faults: faults({ getManyValues: "config" }) });
      const html = await month();
      expect(pageText(html)).toContain(CONNECTION_NEEDS_ATTENTION);
      expect(html).not.toContain("SHEET_ID");
      expect(link(html, "Open Set up to see what is wrong")).toBeUndefined();
      expect(link(html, "Try again")).toBeDefined();
    });
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(Home({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });

  it("shows the full names of the long world, and they wrap", async () => {
    useSheet("long");
    const html = await month();
    const first = cards(html)[0].text;
    expect(first).toContain(LONG_PORTION);
    expect(first).toContain(LONG_TENANT);
    expect(wrapProblems(html, [LONG_PORTION, LONG_TENANT])).toEqual([]);
  });
});

describe("Activity", () => {
  /** The entries of a render, in order, as the day each is under and what it says. */
  function entries(html: string) {
    return named(html, "section")
      .filter((day) => (day.attrs["aria-labelledby"] ?? "").startsWith("day-"))
      .flatMap((day) => {
        const heading = textOf(inside(day, "h2")[0]);
        return inside(day, "li").map((item) => ({ day: heading, text: textOf(item) }));
      });
  }

  it("lists the log newest first under a heading for each day, with a sentence for each entry", async () => {
    const html = await activity();
    expect(named(html, "h2").map((heading) => textOf(heading))).toEqual([
      "Today",
      "Yesterday",
      "Thursday, 15 October",
      "Wednesday, 14 October",
      "17 October 2025",
    ]);
    expect(entries(html).map((entry) => entry.text)).toEqual([
      "First floor, double bedroom Changed Changed Bala's September 2026 payment to ₹ 12,700. ₹ 12,700 9:10 am · by member@example.com · received 17 Oct",
      "First floor, single bedroom Logged Logged ₹ 5,450 from Asha for October 2026 (payment 4). ₹ 5,450 8:20 am · by you · received 17 Oct",
      "First floor, single bedroom Undone Undid Asha's October 2026 payment of ₹ 5,450. removed ₹ 5,450 9:45 am · by you",
      "First floor, single bedroom Logged Logged ₹ 5,450 from Asha for October 2026 (payment 4). ₹ 5,450 9:30 am · by you · received 16 Oct",
      "First floor, single bedroom Logged Logged ₹ 5,450 from Asha for September 2026 (payment 3). ₹ 5,450 6:20 pm · by member@example.com · received 15 Oct",
      "Third floor, hall and kitchen Changed Changed Esha's September 2026 payment to ₹ 5,100. ₹ 5,100 11:05 am · by you · received 15 Oct",
      "Third floor, hall and kitchen Logged Logged ₹ 5,100 from Esha for September 2026 (payment 2). ₹ 5,100 4:40 pm · by member@example.com · received 14 Oct",
      "First floor, double bedroom Logged Logged ₹ 12,700 from Bala for September 2026 (payment 11). ₹ 12,700 10:10 am · by you · received 14 Oct",
      "First floor, single bedroom Logged Logged ₹ 5,200 from Kiran for October 2025 (payment 9). ₹ 5,200 10:15 am · by you · received 17 Oct",
    ]);
    expect(entries(html).map((entry) => entry.day)).toEqual([
      "Today", "Today", "Yesterday", "Yesterday", "Thursday, 15 October", "Thursday, 15 October", "Wednesday, 14 October", "Wednesday, 14 October", "17 October 2025",
    ]);
  });

  it("says by you for a member's own rows, and the owner's address for the owner's", async () => {
    h.viewer = MEMBER;
    const text = entries(await activity()).map((entry) => entry.text);
    expect(text[0]).toContain("9:10 am · by you · received 17 Oct");
    expect(text[1]).toContain("8:20 am · by owner@example.com · received 17 Oct");
  });

  it("narrows to a kind of entry and to a portion, and marks the choices that are on", async () => {
    const undone = await activity({ show: "undone" });
    expect(entries(undone).map((entry) => entry.text)).toEqual([
      "First floor, single bedroom Undone Undid Asha's October 2026 payment of ₹ 5,450. removed ₹ 5,450 9:45 am · by you",
    ]);
    const chosen = (html: string) => named(html, "a").filter((anchor) => anchor.attrs["aria-current"] === "true").map((anchor) => textOf(anchor));
    expect(chosen(undone)).toEqual(["Undone", "All portions"]);

    const changed = await activity({ show: "edited" });
    expect(entries(changed)).toHaveLength(2);
    expect(entries(changed).every((entry) => entry.text.includes(" Changed "))).toBe(true);

    const portion = await activity({ portion: "First floor, double bedroom" });
    expect(entries(portion).map((entry) => entry.text.slice(0, 27))).toEqual(["First floor, double bedroom", "First floor, double bedroom"]);
    expect(chosen(portion)).toEqual(["All", "First floor, double bedroom"]);

    const both = await activity({ show: "logged", portion: "First floor, double bedroom" });
    expect(entries(both)).toHaveLength(1);
    expect(entries(both)[0].text).toContain("Logged ₹ 12,700 from Bala");
  });

  it("lists the portions of the log as choices, and keeps each choice's other filter in its address", async () => {
    const html = await activity({ show: "logged", month: "2026-09" });
    expect(named(html, "a").map((anchor) => [textOf(anchor), anchor.attrs.href])).toEqual([
      ["All", "/activity?month=2026-09"],
      ["Logged", "/activity?show=logged&month=2026-09"],
      ["Changed", "/activity?show=edited&month=2026-09"],
      ["Undone", "/activity?show=undone&month=2026-09"],
      ["All portions", "/activity?show=logged&month=2026-09"],
      ["First floor, double bedroom", "/activity?show=logged&portion=First+floor%2C+double+bedroom&month=2026-09"],
      ["First floor, single bedroom", "/activity?show=logged&portion=First+floor%2C+single+bedroom&month=2026-09"],
      ["Third floor, hall and kitchen", "/activity?show=logged&portion=Third+floor%2C+hall+and+kitchen&month=2026-09"],
    ]);
  });

  it("says nothing was logged yet in the empty world, with no choices to make", async () => {
    useSheet("empty");
    const html = await activity();
    expect(pageText(html)).toContain("Nothing logged yet Payments you log, change or undo show up here, newest first.");
    expect(named(html, "a").map((anchor) => textOf(anchor))).toEqual([]);
    expect(entries(html)).toEqual([]);
  });

  it("says no entry matches when the filters leave none, and leads back to everything", async () => {
    const html = await activity({ show: "undone", portion: "Third floor, hall and kitchen" });
    expect(pageText(html)).toContain("No entries match these filters");
    expect(entries(html)).toEqual([]);
    expect(link(html, "Show everything")?.attrs.href).toBe("/activity");
  });

  it("takes a portion the log does not have as all portions", async () => {
    const html = await activity({ portion: "The attic" });
    expect(entries(html)).toHaveLength(9);
    expect(pageText(html)).not.toContain("No entries match");
  });

  it("says when the log cannot be read, and leads to Try again", async () => {
    useSheet("main", { faults: faults({ getValues: "unavailable" }) });
    const html = await activity({ show: "logged" });
    expect(pageText(html)).toContain("Can't load your Sheet Google isn't responding. Try again in a minute. Try again");
    expect(link(html, "Try again")?.attrs.href).toBe("/activity?show=logged");
    expect(entries(html)).toEqual([]);
  });

  it("shows the full names of the long world, and they wrap", async () => {
    useSheet("long");
    const html = await activity();
    expect(entries(html).filter((entry) => entry.text.includes(LONG_PORTION)).length).toBeGreaterThan(3);
    expect(wrapProblems(html, [LONG_PORTION, LONG_TENANT])).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(ActivityPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("More", () => {
  const rows = (html: string) => named(html, "a").map((anchor) => [textOf(anchor), anchor.attrs.href]);

  it("gives the owner the account, the three rent screens, the three owner screens and Sign out", async () => {
    const html = await more();
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["More"]);
    expect(pageText(html)).toContain("Account Signed in as owner@example.com Owner");
    expect(rows(html)).toEqual([
      ["Overdue rent Who owes what, most first", "/overdue"],
      ["Year at a glance Each portion, month by month", "/year"],
      ["Agreements and hikes Agreements ending and rent going up", "/alerts"],
      ["Portion settings Cycles, hikes, and adding or switching off portions", "/settings"],
      ["Set up Check each part of the connection to your Sheet", "/setup"],
      ["Diagnostics How the app and your Sheet are doing", "/diagnostics"],
    ]);
    expect(named(html, "button").map((button) => textOf(button))).toEqual(["Auto", "Light", "Dark", "Sign out"]);
    expect(pageText(html)).toContain("RentBook · Version 0.1.0");
  });

  it("gives a member the account and the rent screens only", async () => {
    h.viewer = MEMBER;
    const html = await more();
    expect(pageText(html)).toContain("Account Signed in as member@example.com Member");
    expect(rows(html).map(([label]) => label.split(" ")[0])).toEqual(["Overdue", "Year", "Agreements"]);
    expect(html).not.toContain("Portion settings");
    expect(html).not.toContain("Set up");
    expect(html).not.toContain("Diagnostics");
    expect(named(html, "button").map((button) => textOf(button))).toEqual(["Auto", "Light", "Dark", "Sign out"]);
  });

  it("keeps the month in every link", async () => {
    const html = await more({ month: "2026-09" });
    expect(rows(html).map(([, href]) => href)).toEqual([
      "/overdue?month=2026-09",
      "/year?month=2026-09",
      "/alerts?month=2026-09",
      "/settings?month=2026-09",
      "/setup?month=2026-09",
      "/diagnostics?month=2026-09",
    ]);
  });

  it("reads no Sheet", async () => {
    const { fake } = useSheet("main");
    await more();
    expect(fake.calls).toEqual([]);
  });

  it("wraps a long address", async () => {
    const email = `${"a-very-long-name-".repeat(3)}x@example.com`;
    h.viewer = { email, isOwner: true };
    const html = await more();
    expect(email.length).toBeGreaterThan(60);
    expect(pageText(html)).toContain(`Signed in as ${email}`);
    expect(wrapProblems(html, [email])).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(MorePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("Portion settings", () => {
  // A card of a portion: the fieldset whose own first child is the legend (the form's fieldset around them has none).
  const fieldsets = (html: string) => named(html, "fieldset").filter((box) => box.children.some((child) => typeof child !== "string" && child.tag === "legend"));
  const values = (html: string) => named(html, "input").map((input) => input.attrs.value);

  it("has a card of fields for each portion, in Settings order", async () => {
    const html = await settings();
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["Portion settings"]);
    expect(fieldsets(html).map((box) => textOf(inside(box, "legend")[0]))).toEqual([
      "Settings for First floor, single bedroom",
      "Settings for First floor, double bedroom",
      "Settings for Second floor, single bedroom",
      "Settings for Second floor, double bedroom",
      "Settings for Third floor, hall and kitchen",
    ]);
    expect(values(html).filter((value) => value !== undefined)).toEqual([
      "First floor, single bedroom", "11", "5",
      "First floor, double bedroom", "11", "5",
      "Second floor, single bedroom", "11", "5",
      "Second floor, double bedroom", "11", "5",
      "Third floor, hall and kitchen", "11", "5",
    ]);
    expect(named(html, "button").map((button) => textOf(button))).toEqual([
      "Switch off", "Switch off", "Switch off", "Switch off", "Switch off", "Save settings", "Add a portion", "Change order",
    ]);
  });

  it("leads back to More, in the month that was showing", async () => {
    h.search = "month=2026-09";
    const html = await settings({ month: "2026-09" });
    expect(link(html, "Back to More")?.attrs.href).toBe("/more?month=2026-09");
  });

  it("takes a member back to the month screen: the settings are the owner's", async () => {
    h.viewer = MEMBER;
    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/");
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });

  it("says when the Settings cannot be read, and leads to Try again and to Set up", async () => {
    useSheet("main", { faults: faults({ getValues: "config" }) });
    const html = await settings({ month: "2026-09" });
    expect(pageText(html)).toContain("Can't load your Sheet Google could not find that Sheet. Check SHEET_ID.");
    expect(link(html, "Try again")?.attrs.href).toBe("/settings?month=2026-09");
    expect(link(html, "Open Set up to see what is wrong")?.attrs.href).toBe("/setup?month=2026-09");
    expect(fieldsets(html)).toEqual([]);
  });

  it("shows the full name of a long portion", async () => {
    useSheet("long");
    const html = await settings();
    expect(values(html)).toContain(LONG_PORTION);
    expect(pageText(html)).toContain(`Settings for ${LONG_PORTION}`);
    expect(wrapProblems(html, [LONG_PORTION])).toEqual([]);
  });
});

describe("a tenant's page", () => {
  it("shows the current tenancy of p1, with its details, the move-out form and the history of the Tenancy Log", async () => {
    const html = await tenant("p1");
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["First floor, single bedroom"]);
    const text = pageText(html);
    expect(text).toContain("Tenant in the Schedule: Asha");
    expect(text).toContain("Current tenancy Asha Phone 98765 43210 Moved in 1 Jul 2026 Agreement ends 16 Nov 2026 Advance ₹ 10,900 · Held · paid 1 Jul 2026 Notes Not added");
    expect(text).toContain("Move out Record that Asha has moved out.");
    expect(text).toContain("Past tenants No past tenants yet.");
    expect(text).toContain("History Details changed for Asha. Phone number changed. Agreement end set to 16 Nov 2026. 12 Oct, 5:30 pm · by you Details added for Asha. 1 Jul, 10:00 am · by you");
    expect(link(html, "Back to month")?.attrs.href).toBe("/");
    expect(named(html, "a").find((anchor) => anchor.attrs.href?.startsWith("tel:"))).toBeDefined();
  });

  it("centres each detail row's label on its value, so the phone link, a taller target, sits level with its label", async () => {
    const html = await tenant("p1");
    const rows = html.match(/<div class="flex items-center justify-between gap-4 py-1\.5 text-sm"><dt/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain('<div class="flex justify-between gap-4 py-1.5 text-sm"><dt');
  });

  it("keeps the month in the way back and in the forms", async () => {
    h.search = "month=2026-09";
    const html = await tenant("p1", { month: "2026-09" });
    expect(link(html, "Back to month")?.attrs.href).toBe("/?month=2026-09");
  });

  it("shows p5 as vacant since the 1st, with the tenant who left under Past tenants and in the history", async () => {
    const html = await tenant("p5");
    const text = pageText(html);
    expect(text).toContain("Vacant since 1 Oct 2026. Add the next tenant with New tenant on the month screen.");
    expect(text).toContain("Past tenants Esha 1 Aug 2026 to 1 Oct 2026 Advance ₹ 10,200 · Held");
    expect(text).toContain("History Esha moved out on 1 Oct 2026. 1 Oct, 10:00 am · by you");
  });

  it("says there is no tenant yet for a portion that was never let", async () => {
    const text = pageText(await tenant("p4"));
    expect(text).toContain("No tenant recorded yet.");
    expect(text).toContain("Add a tenant from the month screen first. Then you can add their details here.");
    expect(text).toContain("History No changes recorded yet.");
  });

  it("says the same in the empty world, where no portion has a tenant, and that there is no history", async () => {
    useSheet("empty");
    const text = pageText(await tenant("p1"));
    expect(text).toContain("Add a tenant from the month screen first. Then you can add their details here.");
    expect(text).toContain("Past tenants No past tenants yet.");
    expect(text).toContain("History No changes recorded yet. Changes saved in the app from now on are listed here, newest first.");
  });

  it("is not found for a portion that is not in the Settings", async () => {
    await expect(TenantPage({ params: Promise.resolve({ portionId: "p9" }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  });

  describe("when the Tenants tab cannot be read", () => {
    function brokenTenants(): Tabs {
      const tabs = world("main", FIXED_NOW).tabs;
      tabs.Tenants[0][3] = "Mobile";
      return tabs;
    }

    it("says what is wrong in its place and leaves the rest of the app working", async () => {
      useSheet(brokenTenants());
      const html = await tenant("p1");
      expect(pageText(html)).toContain("Can't show the tenant details");
      expect(pageText(html)).toContain('The Tenants tab must have "Phone" in column D (found "Mobile").');
      expect(pageText(html)).toContain("Put the header back, then try again. Logging rent and the other pages still work.");
      expect(link(html, "Open Set up to see what is wrong")?.attrs.href).toBe("/setup");
      expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["First floor, single bedroom"]);
      expect(pageText(html)).not.toContain("Current tenancy");
      // The rest: the month screen still shows its cards.
      const rest = await month();
      expect(cards(rest)).toHaveLength(5);
    });

    it("tells a member the same without a way to Set up, which is the owner's", async () => {
      h.viewer = MEMBER;
      useSheet(brokenTenants());
      const html = await tenant("p1");
      expect(pageText(html)).toContain("Can't show the tenant details");
      expect(link(html, "Open Set up to see what is wrong")).toBeUndefined();
    });
  });

  it("says when the Sheet cannot be read at all, and leads to Try again for this portion", async () => {
    useSheet("main", { faults: faults({ getManyValues: "unavailable" }) });
    const html = await tenant("p1", { month: "2026-09" });
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["Tenant details"]);
    expect(pageText(html)).toContain("Can't load your Sheet Google isn't responding. Try again in a minute.");
    expect(link(html, "Try again")?.attrs.href).toBe("/tenants/p1?month=2026-09");
  });

  it("shows the full names of the long world, and they wrap", async () => {
    useSheet("long");
    const html = await tenant("p1");
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual([LONG_PORTION]);
    expect(pageText(html)).toContain(`Tenant in the Schedule: ${LONG_TENANT}`);
    expect(pageText(html)).toContain(`History Details changed for ${LONG_TENANT}.`);
    expect(wrapProblems(html, [LONG_PORTION, LONG_TENANT])).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(TenantPage({ params: Promise.resolve({ portionId: "p1" }), searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("the sign-in, error and not-found pages", () => {
  it("passes the landmark rules on the sign-in page, with and without a reason", async () => {
    h.viewer = null;
    for (const error of [undefined, "AccessDenied", "Configuration", "Other"]) {
      sound(renderScreen(await SignInPage({ searchParams: Promise.resolve({ error }) })));
    }
  });

  it("passes the landmark rules on error.tsx", () => {
    sound(renderToStaticMarkup(createElement(ErrorPage, { error: new Error("detail"), retry: () => {} })));
  });

  it("passes the landmark rules on global-error.tsx, which is a whole page", () => {
    sound(renderToStaticMarkup(createElement(GlobalError)));
  });

  it("passes the landmark rules on the not-found page", async () => {
    sound(renderScreen(await NotFound()));
  });
});
