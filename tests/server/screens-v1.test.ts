import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configError } from "@/lib/errors";
import { inside, link, named, pageText, textOf } from "../support/html";
import { captureLogs } from "../support/logs";
import { expectSound as sound, FIXED_NOW, MEMBER, OWNER, renderScreen, screenContext, stubTestEnv } from "../support/screens";
import { faults, LONG_PORTION, LONG_TENANT, world, type Faults, type Tabs } from "../support/worlds";
import { wrapProblems } from "../support/wrapping";
import pkg from "../../package.json";

// The screens that waves 3 and 4 added (Set up, Diagnostics, the switched-off part of Portion settings, Overdue, Year, Alerts,
// a tenant's History and the home screen's Needs attention card), each rendered as the real page through the real data path
// against the in-memory Sheet of a world, in its main states. Every render must pass the landmark rules, have no control
// too small for a thumb and show no canary.

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

import AlertsPage from "@/app/alerts/page";
import DiagnosticsPage from "@/app/diagnostics/page";
import Home from "@/app/(month)/page";
import OverduePage from "@/app/overdue/page";
import SetupPage from "@/app/setup/page";
import SettingsPage from "@/app/settings/page";
import TenantPage from "@/app/tenants/[portionId]/page";
import YearPage from "@/app/year/page";

beforeEach(() => {
  captureLogs();
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  // The count of problems logged is kept on the process: start it again, now, so Diagnostics reads the same in every test.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("rentbook.problem-counts")];
  stubTestEnv();
  h.viewer = OWNER;
  h.path = "/";
  h.search = "";
  useSheet("main");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Search = Record<string, string | string[] | undefined>;

/** The Sheet the page reads: a world, or tabs a test made. The fake is returned for a test that wants to look at it. */
function useSheet(source: Parameters<typeof screenContext>[0], options: { faults?: Faults } = {}) {
  const sheet = screenContext(source, options);
  h.ctx = () => sheet.ctx;
  return sheet;
}

const setup = async (search: Search = {}) => sound(renderScreen(await SetupPage({ searchParams: Promise.resolve(search) })));
const diagnostics = async (search: Search = {}) => sound(renderScreen(await DiagnosticsPage({ searchParams: Promise.resolve(search) })));
const settings = async (search: Search = {}) => sound(renderScreen(await SettingsPage({ searchParams: Promise.resolve(search) })));
const overdue = async (search: Search = {}) => sound(renderScreen(await OverduePage({ searchParams: Promise.resolve(search) })));
const year = async (search: Search = {}) => sound(renderScreen(await YearPage({ searchParams: Promise.resolve(search) })));
const alerts = async (search: Search = {}) => sound(renderScreen(await AlertsPage({ searchParams: Promise.resolve(search) })));
const month = async (search: { month?: string } = {}) => sound(renderScreen(await Home({ searchParams: Promise.resolve(search) })));
const tenant = async (portionId: string, search: Search = {}) =>
  sound(renderScreen(await TenantPage({ params: Promise.resolve({ portionId }), searchParams: Promise.resolve(search) })));

/** A world's tabs, for a test to change before it hands them to useSheet. */
const tabsOf = (name: Parameters<typeof world>[0] = "main"): Tabs => world(name, FIXED_NOW).tabs;

/** The writes a fake gateway was asked for: every call that is not a read. */
const writes = (calls: string[]) => calls.filter((call) => !call.startsWith("get") && call !== "listTabs");

/** The text of a step's card on the Set up page, from its heading ("3. Your Sheet OK ..."). */
function step(html: string, number: number): string {
  const found = named(html, "section").find((element) => element.attrs["aria-labelledby"] === `step-${number}`);
  expect(found, `step ${number}`).toBeDefined();
  return textOf(found!);
}

describe("Set up", () => {
  it("tells the owner that everything is connected when the Sheet is as it should be", async () => {
    const { fake } = useSheet("main");
    const html = await setup();
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["Set up"]);
    expect(pageText(html)).toContain("Everything is connected.");
    expect(named(html, "section").filter((card) => /^step-\d$/.test(card.attrs["aria-labelledby"] ?? ""))).toHaveLength(6);
    for (const number of [1, 2, 3, 4, 5, 6]) expect(step(html, number)).toMatch(new RegExp(`^${number}\\. [^]*? OK `));
    expect(step(html, 2)).toContain("The service account is rentbook-robot@example.com.");
    expect(step(html, 5)).toContain("Tenancy Log tab OK Headers are right. 4 entries.");
    expect(named(html, "button")).toEqual([]);
    expect(named(html, "section").some((card) => card.attrs["aria-labelledby"] === "prepare-heading")).toBe(false);
    expect(link(html, "Open Portion settings")?.attrs.href).toBe("/settings");
    expect(link(html, "Check again")?.attrs.href).toBe("/setup");
    expect(writes(fake.calls)).toEqual([]);
  });

  it("keeps the month in its links", async () => {
    h.search = "month=2026-09";
    const html = await setup({ month: "2026-09" });
    expect(link(html, "Back to More")?.attrs.href).toBe("/more?month=2026-09");
    expect(link(html, "Open Portion settings")?.attrs.href).toBe("/settings?month=2026-09");
    expect(link(html, "Check again")?.attrs.href).toBe("/setup?month=2026-09");
  });

  it("shows no setting's value, only that it is set", async () => {
    const html = await setup();
    expect(pageText(html)).toContain("SHEET_ID OK Set.");
    expect(pageText(html)).toContain("AUTH_SECRET OK Set.");
  });

  describe("on a Sheet the app has not been used with", () => {
    it("names the tabs Prepare my Sheet will add, and changes nothing by itself", async () => {
      const { fake } = useSheet("fresh");
      const html = await setup();
      expect(pageText(html)).toContain("Your Sheet needs preparing.");
      const prepare = named(html, "section").find((card) => card.attrs["aria-labelledby"] === "prepare-heading");
      expect(textOf(prepare!)).toContain("Get your Sheet ready Adds the missing tabs (Settings, Payments Log, Tenants and Tenancy Log) with their headers.");
      expect(textOf(prepare!)).toContain("Settings starts with 5 portions from your Schedule header, each with 11 payments per cycle and a 5% hike.");
      expect(named(html, "button").map((button) => textOf(button))).toEqual(["Prepare my Sheet"]);
      expect(step(html, 4)).toMatch(/^4\. Schedule tab OK /);
      expect(step(html, 5)).toMatch(/^5\. RentBook's tabs To do /);
      expect(step(html, 5)).toContain("Settings tab To do Not created yet. Prepare my Sheet creates it with 5 portions found in your header.");
      expect(step(html, 5)).toContain("Tenancy Log tab To do Not created yet. It's added the next time the app opens your Sheet, or by Prepare my Sheet.");
      expect(step(html, 6)).toMatch(/^6\. Portion settings To do /);
      expect(writes(fake.calls)).toEqual([]);
      expect([...fake.tabs.keys()]).toEqual(["Schedule"]);
    });
  });

  describe("when the settings cannot open the Sheet", () => {
    it("says what is waiting: steps 3 to 6 tell the owner to fix the settings first, and 1 and 2 still say what they found", async () => {
      h.ctx = () => {
        throw configError("Google could not find that Sheet. Check SHEET_ID.");
      };
      const html = await setup();
      expect(pageText(html)).toContain("Some checks are waiting.");
      for (const number of [1, 2]) expect(step(html, number)).toMatch(new RegExp(`^${number}\\. [^]*? OK `));
      for (const number of [3, 4, 5, 6]) {
        expect(step(html, number)).toMatch(new RegExp(`^${number}\\. [^]*? Waiting `));
        expect(step(html, number)).toContain("Fix the settings above first.");
      }
      expect(pageText(html).match(/Fix the settings above first\./g)).toHaveLength(11);
      expect(named(html, "button")).toEqual([]);
    });
  });

  it("tells a member that it is the owner's, shows no check and reads nothing", async () => {
    h.viewer = MEMBER;
    const { fake } = useSheet("main");
    const html = await setup();
    expect(pageText(html)).toBe("‹ Set up Set up is for the owner. If something isn't working, ask the owner to open it.");
    expect(html).not.toContain("AUTH_SECRET");
    expect(html).not.toContain("rentbook-robot");
    expect(fake.calls).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(SetupPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("Diagnostics", () => {
  it("says the Sheet is reachable and what each tab holds", async () => {
    const html = await diagnostics();
    const text = pageText(html);
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["Diagnostics"]);
    expect(text).toContain(`App Version ${pkg.version} This server started 17 Oct, 12:00 pm Checks: 26 of 26 OK Open Set up`);
    expect(text).toContain("Google Sheet Answered in 0 ms (tab list) and 0 ms (data). Reachable");
    expect(text).toContain("Schedule: 3 month rows, August 2026 to October 2026");
    expect(text).toContain("Settings: 5 portions on, 0 switched off");
    expect(text).toContain("Payments Log: 9 entries, last saved 17 Oct, 9:10 am");
    expect(text).toContain("Tenants: 4 rows, 3 current");
    expect(text).toContain("Tenancy Log: 4 entries, last saved 12 Oct, 5:30 pm");
    expect(text).toContain("Problems No problems logged since 17 Oct, 12:00 pm. Each server instance counts on its own and starts from zero when it restarts.");
    expect(link(html, "Open Set up")?.attrs.href).toBe("/setup");
    expect(link(html, "Check again")?.attrs.href).toBe("/diagnostics");
  });

  it("keeps the month in its links", async () => {
    const html = await diagnostics({ month: "2026-09" });
    expect(link(html, "Open Set up")?.attrs.href).toBe("/setup?month=2026-09");
    expect(link(html, "Check again")?.attrs.href).toBe("/diagnostics?month=2026-09");
  });

  it("counts the problems this server has logged, by name", async () => {
    useSheet("main", { faults: faults({ getManyValues: "config" }) });
    await month();
    useSheet("main");
    expect(pageText(await diagnostics())).toContain("Since 17 Oct, 12:00 pm on this server: 1 error, 0 warnings (config 1).");
  });

  it("says the Sheet is not reachable when Google does not answer, and reads no tab", async () => {
    useSheet("main", { faults: faults({ listTabs: "unavailable" }) });
    const html = await diagnostics();
    const text = pageText(html);
    expect(text).toContain("Google Sheet Google isn't responding. Try again in a minute. Not reachable");
    expect(text).not.toContain("Reachable Tabs");
    for (const tab of ["Schedule", "Settings", "Payments Log", "Tenants", "Tenancy Log"]) expect(text).toContain(`${tab}: not read`);
    expect(text).toContain("Checks: 15 of 26 OK");
  });

  it("says the settings must be fixed first when they cannot open the Sheet", async () => {
    h.ctx = () => {
      throw configError("Google could not find that Sheet. Check SHEET_ID.");
    };
    const html = await diagnostics();
    expect(pageText(html)).toContain("Google Sheet The settings need fixing before the Sheet can be tried. Not reachable Open Set up");
  });

  it("tells a member that it is the owner's and reads nothing", async () => {
    h.viewer = MEMBER;
    const { fake } = useSheet("main");
    const html = await diagnostics();
    expect(pageText(html)).toBe("‹ Diagnostics Diagnostics are for the owner.");
    expect(fake.calls).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(DiagnosticsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("Portion settings, the parts wave 3 added", () => {
  const cardsOf = (html: string) =>
    named(html, "fieldset")
      .filter((box) => box.children.some((child) => typeof child !== "string" && child.tag === "legend"))
      .map((box) => textOf(inside(box, "legend")[0]));
  const switchedOff = (html: string) => named(html, "section").find((box) => box.attrs["aria-labelledby"] === "switched-off-heading");

  it("lists a switched-off portion apart, with a way to switch it on, and keeps it out of the cards", async () => {
    const tabs = tabsOf();
    tabs.Settings[4][7] = "No";
    useSheet(tabs);
    const html = await settings();
    expect(cardsOf(html)).toEqual([
      "Settings for First floor, single bedroom",
      "Settings for First floor, double bedroom",
      "Settings for Second floor, single bedroom",
      "Settings for Third floor, hall and kitchen",
    ]);
    expect(textOf(switchedOff(html)!)).toBe("Switched off Second floor, double bedroom Switched off. Its history is kept. Switch on");
    const button = named(html, "button").find((found) => found.attrs["aria-label"] === "Switch on Second floor, double bedroom");
    expect(textOf(button!)).toBe("Switch on");
  });

  it("has Add a portion and Change order under the form, and Save settings before them", async () => {
    const html = await settings();
    expect(named(html, "button").map((button) => textOf(button)).slice(-3)).toEqual(["Save settings", "Add a portion", "Change order"]);
    expect(switchedOff(html)).toBeUndefined();
  });

  it("has no Switched off section until a portion is off", async () => {
    expect(switchedOff(await settings())).toBeUndefined();
  });

  it("shows the full name of a long portion that is switched off, and it wraps", async () => {
    const tabs = tabsOf("long");
    tabs.Settings[1][7] = "No";
    useSheet(tabs);
    const html = await settings();
    expect(textOf(switchedOff(html)!)).toContain(LONG_PORTION);
    expect(wrapProblems(html, [LONG_PORTION])).toEqual([]);
  });

  it("shows the full name of a long portion that is on, and it wraps", async () => {
    useSheet("long");
    const html = await settings();
    expect(pageText(html)).toContain(`Settings for ${LONG_PORTION}`);
    expect(wrapProblems(html, [LONG_PORTION])).toEqual([]);
  });
});

describe("Overdue rent", () => {
  it("lists who owes, most first: Chitra for two months, then Bala for one, and the total", async () => {
    const html = await overdue();
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["Overdue rent"]);
    expect(pageText(html)).toContain("₹ 31,335 overdue 2 portions · counted up to October 2026");
    const owing = named(html, "li").filter((item) => inside(item, "h2").length > 0).map((item) => textOf(item));
    expect(owing).toEqual([
      "Second floor, single bedroom ₹ 18,000 Chitra · 2 unpaid months Oldest: September 2026, 46 days overdue October 2026 Unpaid: ₹ 9,000 September 2026 Unpaid: ₹ 9,000",
      "First floor, double bedroom ₹ 13,335 Bala · 1 unpaid month Oldest: October 2026, 16 days overdue October 2026 Unpaid: ₹ 13,335",
    ]);
  });

  it("does not list a month that has a payment, at whatever amount: Asha paid 3,000 for October and 6,000 for August", async () => {
    const tabs = tabsOf("main");
    // the amounts of the p1 payments, in the Schedule's August and October rows (the rent is 5,450)
    tabs.Schedule[3][3] = 6000;
    tabs.Schedule[5][3] = 3000;
    useSheet(tabs);
    const html = await overdue();
    expect(pageText(html)).toContain("₹ 31,335 overdue 2 portions · counted up to October 2026");
    expect(named(html, "li").filter((item) => inside(item, "h2").length > 0).map((item) => inside(item, "h2").map((heading) => textOf(heading))[0])).toEqual([
      "Second floor, single bedroom",
      "First floor, double bedroom",
    ]);
    expect(pageText(html)).not.toMatch(/short|Paid ₹/);
  });

  it("links each month to that month's screen, and the arrow back to the month on show", async () => {
    h.search = "month=2026-09";
    const html = await overdue({ month: "2026-09" });
    expect(link(html, "Back to month")?.attrs.href).toBe("/?month=2026-09");
    expect(named(html, "ol").flatMap((list) => inside(list, "a")).map((anchor) => anchor.attrs.href)).toEqual(["/", "/?month=2026-09", "/"]);
  });

  it("explains how it is worked out, closed until asked for", async () => {
    const html = await overdue();
    expect(named(html, "details")).toHaveLength(1);
    expect(pageText(html)).toContain("How this is worked out Rent for a month is due on the 1st and counts as overdue from the 6th.");
  });

  it("says nothing is overdue when every let portion has paid", async () => {
    useSheet("empty");
    const html = await overdue();
    expect(pageText(html)).toContain("Nothing overdue Every let portion has paid in full up to October 2026. Back to the month");
    expect(link(html, "Back to the month")?.attrs.href).toBe("/");
    expect(pageText(html)).not.toContain("overdue 2 portions");
  });

  it("says when the Sheet cannot be read, and leads to Try again in the same month", async () => {
    useSheet("main", { faults: faults({ getManyValues: "unavailable" }) });
    const html = await overdue({ month: "2026-09" });
    expect(pageText(html)).toContain("Can't load your Sheet Google isn't responding. Try again in a minute. Try again");
    expect(link(html, "Try again")?.attrs.href).toBe("/overdue?month=2026-09");
    expect(named(html, "details")).toEqual([]);
  });

  it("shows the full names of a long portion and tenant that owe, and they wrap", async () => {
    const tabs = tabsOf("long");
    // Asha's October payment is not logged: she owes it from the 6th.
    for (const column of [1, 2, 3]) tabs.Schedule[5][column] = "";
    useSheet(tabs);
    const html = await overdue();
    expect(pageText(html)).toContain(`${LONG_PORTION} ₹ 5,450 ${LONG_TENANT} · 1 unpaid month`);
    expect(wrapProblems(html, [LONG_PORTION, LONG_TENANT])).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(OverduePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("Year at a glance", () => {
  const rows = (html: string) => named(html, "ol").filter((list) => (list.attrs["aria-label"] ?? "").startsWith("Months of "));
  /** The label of each month of each portion, as a screen reader says it. */
  const labels = (html: string) =>
    rows(html).map((list) =>
      inside(list, "li").map((cell) => {
        const own = inside(cell, "a")[0];
        return own ? own.attrs["aria-label"].replace(/\u00a0/g, " ") : textOf(inside(cell, "span").find((span) => span.attrs.class?.includes("sr-only"))!);
      }),
    );

  it("has twelve months for each of the five portions, in this year", async () => {
    const html = await year();
    expect(named(html, "nav").map((nav) => nav.attrs["aria-label"])).toContain("Year");
    expect(named(html, "h2").map((heading) => textOf(heading)).slice(0, 1)).toEqual(["2026"]);
    expect(rows(html)).toHaveLength(5);
    for (const row of labels(html)) expect(row).toHaveLength(12);
    expect(pageText(html)).toContain("Received ₹ 60,950 of ₹ 92,285");
  });

  it("shows the months as the Schedule says: p1 paid August to October, p3 unpaid September and October, p5 vacant from October", async () => {
    const [p1, p2, p3, p4, p5] = labels(await year());
    expect(p1.slice(0, 7).every((label) => label.endsWith(": no record"))).toBe(true);
    expect(p1.slice(7)).toEqual([
      "August 2026, First floor, single bedroom: paid ₹ 5,450",
      "September 2026, First floor, single bedroom: paid ₹ 5,450",
      "October 2026, First floor, single bedroom: paid ₹ 5,450",
      "November 2026, First floor, single bedroom: not due yet",
      "December 2026, First floor, single bedroom: not due yet",
    ]);
    expect(p2.slice(7, 10)).toEqual([
      "August 2026, First floor, double bedroom: paid ₹ 12,700",
      "September 2026, First floor, double bedroom: paid ₹ 12,700",
      "October 2026, First floor, double bedroom: unpaid, ₹ 13,335 due",
    ]);
    expect(p3.slice(7, 10)).toEqual([
      "August 2026, Second floor, single bedroom: paid ₹ 9,000",
      "September 2026, Second floor, single bedroom: unpaid, ₹ 9,000 due",
      "October 2026, Second floor, single bedroom: unpaid, ₹ 9,000 due",
    ]);
    expect(p3.slice(10)).toEqual([
      "November 2026, Second floor, single bedroom: not due yet",
      "December 2026, Second floor, single bedroom: not due yet",
    ]);
    expect(p4.slice(7).every((label) => label.endsWith(": vacant"))).toBe(true);
    expect(p5.slice(7)).toEqual([
      "August 2026, Third floor, hall and kitchen: paid ₹ 5,100",
      "September 2026, Third floor, hall and kitchen: paid ₹ 5,100",
      "October 2026, Third floor, hall and kitchen: vacant",
      "November 2026, Third floor, hall and kitchen: vacant",
      "December 2026, Third floor, hall and kitchen: vacant",
    ]);
  });

  it("shows a month paid at another amount as paid, with the amount received: no part-paid month", async () => {
    const tabs = tabsOf("main");
    tabs.Schedule[3][3] = 6000;
    tabs.Schedule[5][3] = 3000;
    useSheet(tabs);
    const [p1] = labels(await year());
    expect(p1.slice(7, 10)).toEqual([
      "August 2026, First floor, single bedroom: paid ₹ 6,000",
      "September 2026, First floor, single bedroom: paid ₹ 5,450",
      "October 2026, First floor, single bedroom: paid ₹ 3,000",
    ]);
  });

  it("links a month to that month's screen, and a month before the Schedule leads nowhere", async () => {
    const html = await year();
    const cells = inside(rows(html)[0], "li");
    expect(inside(cells[0], "a")).toEqual([]);
    expect(cells.slice(7).map((cell) => inside(cell, "a")[0].attrs.href)).toEqual(["/?month=2026-08", "/?month=2026-09", "/", "/?month=2026-11", "/?month=2026-12"]);
  });

  it("explains the colours in a key of glyphs and words", async () => {
    expect(pageText(await year())).toContain("Paid Unpaid Vacant Not due yet");
  });

  it("says nothing was recorded in a year before the Schedule, and leads to the year it starts in", async () => {
    const html = await year({ year: "2025" });
    expect(pageText(html)).toContain("Nothing recorded for 2025 Your Schedule starts in August 2026. Show 2026");
    expect(link(html, "Show 2026")?.attrs.href).toBe("/year?year=2026");
    expect(rows(html)).toEqual([]);
  });

  it("takes the year of the month that was showing, and keeps the month in the arrows", async () => {
    const html = await year({ month: "2025-12" });
    expect(textOf(named(html, "h2")[0])).toBe("2025");
    expect(link(html, "Next year")?.attrs.href).toBe("/year?year=2026&month=2025-12");
  });

  it("says when the Sheet cannot be read, and leads to Try again for the same year", async () => {
    useSheet("main", { faults: faults({ getManyValues: "unavailable" }) });
    const html = await year();
    expect(pageText(html)).toContain("Can't load your Sheet Google isn't responding. Try again in a minute. Try again");
    expect(link(html, "Try again")?.attrs.href).toBe("/year?year=2026");
    expect(rows(html)).toEqual([]);
  });

  it("shows the full name of a long portion, and it wraps", async () => {
    useSheet("long");
    const html = await year();
    expect(pageText(html)).toContain(`${LONG_PORTION} ₹ 16,350 of ₹ 16,350`);
    expect(wrapProblems(html, [LONG_PORTION])).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(YearPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("Agreements and hikes", () => {
  const alertsOf = (html: string, heading: string) => {
    const found = named(html, "section").find((box) => box.attrs["aria-labelledby"] === `${heading}-heading`);
    return inside(found!, "li").map((item) => textOf(item));
  };

  it("lists the agreement that ended first, then the one that ends soon, and the hike that is next", async () => {
    const html = await alerts();
    expect(named(html, "h1").map((heading) => textOf(heading))).toEqual(["Agreements and hikes"]);
    expect(alertsOf(html, "agreements")).toEqual([
      "Second floor, single bedroom Ended Chitra Agreement ended 7 days ago, on 10 Oct 2026. Renewed? Change the agreement end in Details. Moved out? Record the move-out there. Details",
      "First floor, single bedroom 30 days left Asha Agreement ends in 30 days, on 16 Nov 2026. Details",
    ]);
    expect(alertsOf(html, "hikes")).toEqual([
      "First floor, double bedroom Next payment Bala Rent goes up 5% with the next payment (October 2026): ₹ 12,700 to ₹ 13,335.",
    ]);
    expect(pageText(html)).toContain("A hike comes with the first payment of a new cycle (see Portion settings). The app sends no reminders: check here.");
  });

  it("links each agreement to its tenant's page, in the month on show", async () => {
    const html = await alerts({ month: "2026-09" });
    expect(link(html, "Details for Second floor, single bedroom")?.attrs.href).toBe("/tenants/p3?month=2026-09");
    expect(link(html, "Details for First floor, single bedroom")?.attrs.href).toBe("/tenants/p1?month=2026-09");
  });

  it("says that nothing is coming in the empty world: both lines", async () => {
    useSheet("empty");
    const html = await alerts();
    expect(pageText(html)).toContain("Agreements No agreement ends in the next 60 days. Rent hikes No rent hike in the next 2 months.");
    expect(named(html, "li")).toEqual([]);
  });

  it("says when the Sheet cannot be read, and leads to Try again", async () => {
    useSheet("main", { faults: faults({ getManyValues: "unavailable" }) });
    const html = await alerts({ month: "2026-09" });
    expect(pageText(html)).toContain("Can't load your Sheet Google isn't responding. Try again in a minute. Try again");
    expect(link(html, "Try again")?.attrs.href).toBe("/alerts?month=2026-09");
    expect(named(html, "section")).toEqual([]);
  });

  it("says that the agreements are not known when the Tenants tab cannot be read, and does not say none end", async () => {
    const tabs = tabsOf();
    tabs.Tenants[0][3] = "Mobile";
    useSheet(tabs);
    const html = await alerts();
    expect(pageText(html)).not.toContain("No agreement ends in the next 60 days.");
    expect(pageText(html)).toContain('The Tenants tab must have "Phone" in column D (found "Mobile").');
  });

  it("shows the full names of a long portion and tenant in an agreement and in a hike, and they wrap", async () => {
    const tabs = tabsOf("long");
    // Asha's count reaches the end of the cycle this month, so the next payment carries the hike.
    tabs.Schedule[3][2] = 9;
    tabs.Schedule[4][2] = 10;
    tabs.Schedule[5][2] = 11;
    useSheet(tabs);
    const html = await alerts();
    expect(alertsOf(html, "agreements").some((item) => item.includes(LONG_TENANT))).toBe(true);
    expect(alertsOf(html, "hikes").some((item) => item.includes(`${LONG_PORTION} November 2026 ${LONG_TENANT}`))).toBe(true);
    expect(wrapProblems(html, [LONG_PORTION, LONG_TENANT])).toEqual([]);
  });

  it("sends a person who is not signed in to sign in", async () => {
    h.viewer = null;
    await expect(AlertsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin");
  });
});

describe("a tenant's History", () => {
  const historyOf = (html: string) => {
    const found = named(html, "section").find((box) => box.attrs["aria-labelledby"] === "history-heading");
    return textOf(found!);
  };

  it("lists what was changed for p1, newest first: the edit with its two lines, then the first details", async () => {
    expect(historyOf(await tenant("p1"))).toBe(
      "History Details changed for Asha. Phone number changed. Agreement end set to 16 Nov 2026. 12 Oct, 5:30 pm · by you Details added for Asha. 1 Jul, 10:00 am · by you",
    );
  });

  it("names the one who saved it: a member sees the owner's address, and the owner sees by you", async () => {
    h.viewer = MEMBER;
    expect(historyOf(await tenant("p1"))).toContain("12 Oct, 5:30 pm · by owner@example.com Details added for Asha. 1 Jul, 10:00 am · by owner@example.com");
    h.viewer = OWNER;
    expect(historyOf(await tenant("p1"))).toContain("12 Oct, 5:30 pm · by you Details added for Asha. 1 Jul, 10:00 am · by you");
  });

  it("shows p5's move-out", async () => {
    expect(historyOf(await tenant("p5"))).toBe("History Esha moved out on 1 Oct 2026. 1 Oct, 10:00 am · by you");
  });

  it("says no changes are recorded for a portion the log does not mention", async () => {
    expect(historyOf(await tenant("p2"))).toBe(
      "History No changes recorded yet. Changes saved in the app from now on are listed here, newest first. Changes made straight in the Sheet are not.",
    );
  });

  it("says the same in the empty world", async () => {
    useSheet("empty");
    expect(historyOf(await tenant("p1"))).toContain("History No changes recorded yet.");
  });

  it("holds no phone number and no note: the log says only that they changed", async () => {
    const tabs = tabsOf();
    tabs.Tenants[1][11] = "Prefers cash";
    useSheet(tabs);
    const html = await tenant("p1");
    expect(historyOf(html)).not.toContain("98765");
    expect(historyOf(html)).not.toContain("Prefers cash");
  });

  describe("when the Tenancy Log cannot be shown", () => {
    it("says so in a warning in its place, and the rest of the page is there: a header that is wrong", async () => {
      const tabs = tabsOf();
      tabs["Tenancy Log"][0][3] = "What";
      useSheet(tabs);
      const html = await tenant("p1");
      expect(historyOf(html)).toBe(
        'History The history can\'t be shown right now. The Tenancy Log tab must have "Action" in column D (found "What"). Put the headers back to see the history; saving changes still works.',
      );
      const notice = named(html, "p").find((found) => textOf(found).startsWith("The history can't be shown"));
      expect(notice?.attrs.class).toContain("bg-warn-bg");
      expect(pageText(html)).toContain("Current tenancy Asha Phone 98765 43210");
      expect(pageText(html)).toContain("Past tenants No past tenants yet.");
    });

    it("says so in a warning in its place, and the rest of the page is there: a read that fails", async () => {
      const set = faults();
      const { ctx } = useSheet("main", { faults: set });
      // The tabs are checked and the snapshot is kept, as on a normal visit; then only the Tenancy Log's read fails.
      await ctx.cache!.get();
      set.getValues = "unavailable";
      const html = await tenant("p1");
      expect(historyOf(html)).toBe("History The history can't be shown right now. Google isn't responding. Try again in a minute.");
      expect(pageText(html)).toContain("Current tenancy Asha Phone 98765 43210");
    });

    it("tells a member to ask the owner when the connection is what is wrong", async () => {
      h.viewer = MEMBER;
      const set = faults();
      const { ctx } = useSheet("main", { faults: set });
      await ctx.cache!.get();
      set.getValues = "config";
      expect(historyOf(await tenant("p1"))).toBe("History The history can't be shown right now. The Sheet connection needs attention. Ask the owner.");
    });
  });

  it("wraps the long names in a change", async () => {
    useSheet("long");
    const html = await tenant("p1");
    expect(historyOf(html)).toContain(`Details changed for ${LONG_TENANT}.`);
    expect(wrapProblems(html, [LONG_TENANT])).toEqual([]);
  });
});

describe("the home screen's Needs attention card", () => {
  const rows = (html: string) => {
    const card = named(html, "section").find((box) => box.attrs["aria-label"] === "Needs attention");
    return card ? inside(card, "a").map((anchor) => [textOf(anchor), anchor.attrs.href]) : null;
  };

  it("lists, this month, what is overdue, the agreements and the hike, in that order, each leading to its screen", async () => {
    expect(rows(await month())).toEqual([
      ["Rent overdue: 2 portions, ₹ 31,335", "/overdue?month=2026-10"],
      ["1 agreement ended", "/alerts?month=2026-10"],
      ["1 agreement ends within 60 days", "/alerts?month=2026-10"],
      ["Rent goes up soon for 1 portion", "/alerts?month=2026-10#hikes"],
    ]);
  });

  it("does not count a month paid at another amount in the overdue row", async () => {
    const tabs = tabsOf("main");
    tabs.Schedule[5][3] = 3000; // Asha paid 3,000 for October against the rent of 5,450
    useSheet(tabs);
    expect(rows(await month())?.[0]).toEqual(["Rent overdue: 2 portions, ₹ 31,335", "/overdue?month=2026-10"]);
  });

  it("is on this month's screen only: no card on September", async () => {
    expect(rows(await month({ month: "2026-09" }))).toBeNull();
    expect(rows(await month({ month: "2026-10" }))).not.toBeNull();
  });

  it("is not there in the empty world, where nothing is due", async () => {
    useSheet("empty");
    expect(rows(await month())).toBeNull();
  });

  it("is not there when the Sheet cannot be read: the month screen says why", async () => {
    useSheet("main", { faults: faults({ getManyValues: "unavailable" }) });
    const html = await month();
    expect(rows(html)).toBeNull();
    expect(pageText(html)).toContain("Can't load your Sheet");
  });
});
