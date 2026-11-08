import path from "node:path";
import { toActivityEntry } from "@/lib/activity-view";
import { TABS } from "@/lib/app-nav";
import { BRAND } from "@/lib/brand";
import { firstVacantMonth } from "@/lib/domain/vacancy";
import { addDays, addMonths, currentYm, firstDayOf, todayIso, ymKey } from "@/lib/domain/year-month";
import { CONNECTION_NEEDS_ATTENTION, unavailable } from "@/lib/errors";
import { formatDay, formatMonthTitle, formatRupees } from "@/lib/format";
import { yearCellLabel } from "@/lib/report-copy";
import { headline } from "@/lib/setup-checks";
import {
  DETAILS_SAVED_TOAST,
  logToastText,
  moveOutToastText,
  newTenantToastText,
  replaceToastText,
  SETTINGS_SAVED_TOAST,
} from "@/lib/toast-copy";
import { undoConfirmationText, undoToastText } from "@/lib/undo-copy";
import { CONFIG_FAULT_MESSAGE, LONG_PORTION, LONG_TENANT, PORTION_NAMES } from "../../tests/support/names";
import { isPlainActivityAddress, leaked, scriptsWithoutNonce, type PwContext, type PwLocator, type PwPage } from "./helpers";

/**
 * The checks of the end-to-end run, and what they are given: the sweep (every page, as the owner and as a member, light and
 * dark) and the journeys. run.ts builds and starts the app, makes a `Run` and calls each check in order, on one server, so a
 * check may expect what an earlier one saved (`needs` names the checks it starts from, so `--only` can still run it).
 *
 * A check throws when something is not as it should be. What the browser noticed while it ran (a console error, a page error,
 * a blocked address, a request that is not to the local server) fails it too: run.ts collects those.
 */

export type Who = "owner" | "member" | "nobody";
export type Scheme = "light" | "dark";

export type Actor = { who: Who; scheme: Scheme; page: PwPage; context: PwContext };

export interface Run {
  /** The address of the local server, such as http://localhost:4123. */
  readonly base: string;
  /** The day the run is on: the Sheet's world is made for it. */
  readonly now: Date;
  /** The secrets and the Sheet's id that no page and no output of the server may hold, by name. */
  readonly canaries: Record<string, string>;
  /** The folder the screenshots of a pass are saved in, or null when none were asked for (--shots). */
  readonly shots: string | null;
  /** The signed-in person (or nobody), in a phone-sized browser window of their own, in the colour scheme; kept for the whole run. */
  actor(who: Who, scheme?: Scheme): Promise<Actor>;
  /** Makes methods of the Sheet fail from now on: `{ getValues: "unavailable" }` (see tests/support/worlds.ts). */
  fail(faults: Record<string, string>): void;
  /** Makes every method of the Sheet work again. */
  heal(): void;
  /** The check expects the server to answer with an HTTP error (a page that is not found, a save the Sheet refuses), which the browser writes to its console. */
  expectsHttpError(): void;
  /** Says something was wrong, and goes on: the check fails at its end with every problem it found. */
  problem(text: string): void;
}

export type Check = { name: string; needs?: readonly string[]; run(run: Run): Promise<void> };

/** A pause, for the few places something has to settle that the page gives no sign of. */
export const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// The sweep

type Expected = { status: number; path?: string };
type SweepPage = { path: (month: string) => string; owner: Expected; member: Expected; name: string };

/** The pages of the app, with what the owner and a member each get. A member is sent home from Portion settings. */
const PAGES: SweepPage[] = [
  { name: "month", path: () => "/", owner: { status: 200 }, member: { status: 200 } },
  { name: "last-month", path: (month) => `/?month=${month}`, owner: { status: 200 }, member: { status: 200 } },
  { name: "activity", path: () => "/activity", owner: { status: 200 }, member: { status: 200 } },
  { name: "more", path: () => "/more", owner: { status: 200 }, member: { status: 200 } },
  { name: "settings", path: () => "/settings", owner: { status: 200 }, member: { status: 200, path: "/" } },
  { name: "tenant-p1", path: () => "/tenants/p1", owner: { status: 200 }, member: { status: 200 } },
  { name: "tenant-p5", path: () => "/tenants/p5", owner: { status: 200 }, member: { status: 200 } },
  { name: "setup", path: () => "/setup", owner: { status: 200 }, member: { status: 200 } },
  { name: "diagnostics", path: () => "/diagnostics", owner: { status: 200 }, member: { status: 200 } },
  { name: "overdue", path: () => "/overdue", owner: { status: 200 }, member: { status: 200 } },
  { name: "year", path: () => "/year", owner: { status: 200 }, member: { status: 200 } },
  { name: "alerts", path: () => "/alerts", owner: { status: 200 }, member: { status: 200 } },
  { name: "not-found", path: () => "/no-such-page", owner: { status: 404 }, member: { status: 404 } },
];

/** What the page has, read in the page itself: the top heading and the main area, how wide it draws, which colour scheme it got, and where it is. */
const PROBE = `(() => ({
  h1: document.querySelectorAll("h1").length,
  main: document.querySelectorAll("main").length,
  width: document.documentElement.scrollWidth,
  dark: matchMedia("(prefers-color-scheme: dark)").matches,
  where: location.pathname + location.search,
}))()`;

/** True once the page has one top heading and one main area: a streamed page has two of each while its loading screen is still there. */
const SETTLED = `document.querySelectorAll("h1").length === 1 && document.querySelectorAll("main").length === 1`;

type Probe = { h1: number; main: number; width: number; dark: boolean; where: string };

/** The width of the phone: a page wider than this scrolls sideways. */
const PHONE_WIDTH = 390;

/** Opens one page as `actor` and returns what is wrong with it, each with who saw it where. */
async function inspect(run: Run, actor: Actor, address: string, expected: Expected, name: string): Promise<string[]> {
  const label = `${actor.who} ${actor.scheme} ${address}`;
  const problems: string[] = [];
  const response = await actor.page.goto(`${run.base}${address}`, { waitUntil: "load" });
  if (response === null) return [`${label}: no answer`];
  // The HTML as the server sent it, read before the page runs on: a page that moves on (a redirect in the browser) loses its body.
  const html = await response.text().catch((error: unknown) => {
    problems.push(`${label}: could not read the page's HTML (${error instanceof Error ? error.message.split("\n")[0] : error})`);
    return "";
  });
  // Anything that goes wrong as the page starts up (hydration, a blocked script) is reported by the browser a moment after load.
  await sleep(200);
  if (response.status() !== expected.status) problems.push(`${label}: status ${response.status()}, expected ${expected.status}`);
  // A page that streams shows its loading screen first and swaps the real page in a moment later: wait for it to settle, and
  // report what is there if it never does.
  for (let waited = 0; waited < 4000 && !(await actor.page.evaluate<boolean>(SETTLED)); waited += 100) await sleep(100);
  const probe = JSON.parse(await actor.page.evaluate<string>(`JSON.stringify(${PROBE})`)) as Probe;
  const expectedPath = expected.path ?? address;
  if (probe.where !== expectedPath) problems.push(`${label}: ended on ${probe.where}, expected ${expectedPath}`);
  if (probe.h1 !== 1) problems.push(`${label}: ${probe.h1} h1 headings, expected 1`);
  if (probe.main !== 1) problems.push(`${label}: ${probe.main} main areas, expected 1`);
  if (probe.width > PHONE_WIDTH) problems.push(`${label}: ${probe.width} px wide, wider than the ${PHONE_WIDTH} px screen`);
  if (probe.dark !== (actor.scheme === "dark")) problems.push(`${label}: the page is not in ${actor.scheme} mode`);
  if (html !== "" && !/<script/i.test(html)) problems.push(`${label}: the page has no script at all, so the nonce check proves nothing`);
  const bare = scriptsWithoutNonce(html);
  if (bare > 0) problems.push(`${label}: ${bare} script tags without a nonce`);
  for (const canary of leaked(html, run.canaries)) problems.push(`${label}: the page holds the ${canary} value`);
  if (run.shots !== null) {
    await actor.page.screenshot({ path: path.join(run.shots, `${actor.who}-${actor.scheme}-${name}.png`), fullPage: true });
  }
  return problems;
}

const sweep: Check = {
  name: "sweep",
  async run(run) {
    const lastMonth = ymKey(addMonths(currentYm(run.now), -1));
    // A page not found makes the browser write "Failed to load resource" to its console.
    run.expectsHttpError();
    const problems: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      for (const who of ["owner", "member"] as const) {
        const actor = await run.actor(who, scheme);
        for (const page of PAGES) problems.push(...(await inspect(run, actor, page.path(lastMonth), page[who], page.name)));
      }
      const nobody = await run.actor("nobody", scheme);
      problems.push(...(await inspect(run, nobody, "/signin", { status: 200 }, "signin")));
    }
    for (const problem of problems) run.problem(problem);
  },
};

// What the journeys share

const WAIT = 8000;
const [P1, P2, P3, P4, P5] = PORTION_NAMES;
const OWNER = "owner@example.com";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0];

/** This month and the one before it, as the screens write them. */
function months(run: Run) {
  const now = currentYm(run.now);
  const before = addMonths(now, -1);
  return { key: ymKey(now), title: formatMonthTitle(now), beforeKey: ymKey(before), beforeTitle: formatMonthTitle(before), today: todayIso(run.now) };
}

/** Waits for something the page shows. */
async function see(locator: PwLocator, what: string, timeout = WAIT): Promise<void> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    throw new Error(`Expected to see ${what}, and it did not show`);
  }
}

/** Waits for something to be gone from the page (or never to have been there). */
async function gone(locator: PwLocator, what: string, timeout = WAIT): Promise<void> {
  try {
    await locator.first().waitFor({ state: "hidden", timeout });
  } catch {
    throw new Error(`Expected ${what} to be gone, and it stayed`);
  }
}

async function tap(locator: PwLocator, what: string): Promise<void> {
  try {
    await locator.first().click({ timeout: WAIT });
  } catch (error) {
    throw new Error(`Could not tap ${what} (${firstLine(error)})`);
  }
}

async function type(locator: PwLocator, value: string, what: string): Promise<void> {
  try {
    await locator.first().fill(value, { timeout: WAIT });
  } catch (error) {
    throw new Error(`Could not fill in ${what} (${firstLine(error)})`);
  }
}

/** Polls until `probe` is true. */
async function until(what: string, probe: () => Promise<boolean>, timeout = WAIT): Promise<void> {
  for (let waited = 0; waited < timeout; waited += 100) {
    if (await probe()) return;
    await sleep(100);
  }
  throw new Error(`Waited for ${what}, and it did not happen`);
}

/** Waits until the address is one the test accepts. */
const arrive = (page: PwPage, what: string, accept: (url: URL) => boolean) => until(what, async () => accept(new URL(page.url())));

/**
 * One top heading, one main area, and every control of the page alive (React has taken the page over): only then is a tap sure to
 * do something. The hidden inputs that carry a server action's id are left out: React never gives them properties.
 */
const READY = `(() => {
  const alive = (element) => Object.keys(element).some((key) => key.startsWith("__reactProps$"));
  return document.querySelectorAll("h1").length === 1 && document.querySelectorAll("main").length === 1 &&
    [...document.querySelectorAll("a, button, input:not([type=hidden]), select, textarea")].every(alive);
})()`;

const ready = (page: PwPage) => until("the page to be ready", () => page.evaluate<boolean>(READY));

/** Opens an address, and waits until the page is ready. */
async function open(run: Run, page: PwPage, address: string): Promise<void> {
  await page.goto(`${run.base}${address}`, { waitUntil: "load" });
  await ready(page);
}

const text = (page: PwPage) => page.locator("body").innerText();

/** The month screen's card of a portion. */
const card = (page: PwPage, name: string) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });

/** The month screen's title, whichever month it shows. */
const title = (page: PwPage, month: string) => page.getByRole("heading", { level: 1 }).filter({ hasText: month });

/** The toast on the screen: it lives in a status region, and goes after four seconds. */
const toast = (page: PwPage, words: string) => see(page.getByRole("status").filter({ hasText: words }), `the toast "${words}"`);

const dialog = (page: PwPage) => page.getByRole("dialog");

const onMonth = (key: string | null) => (url: URL) => url.pathname === "/" && url.searchParams.get("month") === key;

/** Opens the Log payment sheet of a portion's card. */
async function openLog(page: PwPage, portion: string): Promise<PwLocator> {
  await tap(card(page, portion).getByRole("button", { name: "Log payment", exact: true }), `Log payment on ${portion}`);
  await see(dialog(page).getByRole("heading", { name: "Log payment" }), "the Log payment sheet");
  return dialog(page);
}

/** The pill of a card ("Paid", "Pending", "Vacant"). */
const pill = (page: PwPage, portion: string, word: string) => card(page, portion).getByText(word, { exact: true });

// 1. A Sheet that cannot be read

const READS = { getManyValues: "unavailable", getValues: "unavailable", listTabs: "unavailable" };
const CONFIG_READS = { getManyValues: "config", getValues: "config", listTabs: "config" };

const loadError: Check = {
  name: "load-error",
  async run(run) {
    const owner = (await run.actor("owner")).page;
    const member = (await run.actor("member")).page;
    // Google not answering: the same words on every screen that reads the Sheet, and a way to try again.
    run.fail(READS);
    for (const address of ["/", "/activity", "/tenants/p1"]) {
      await open(run, owner, address);
      await see(owner.getByText(unavailable().message), `"${unavailable().message}" on ${address}`);
      await see(owner.getByRole("link", { name: "Try again" }), `Try again on ${address}`);
    }
    // A wrong setting: the owner is sent to Set up, anyone else is told to ask the owner.
    run.fail(CONFIG_READS);
    await open(run, owner, "/");
    await see(owner.getByText(CONFIG_FAULT_MESSAGE), "the connection problem, for the owner");
    await see(owner.getByRole("link", { name: /Open Set up/ }), "the way to Set up, for the owner");
    await open(run, member, "/");
    await see(member.getByText(CONNECTION_NEEDS_ATTENTION), "the member's words for a connection problem");
    if (await member.getByText(CONFIG_FAULT_MESSAGE).count()) throw new Error("A member can read the connection problem's detail");
    if (await member.getByRole("link", { name: /Open Set up/ }).count()) throw new Error("A member is offered Set up");
    // Mended: Try again brings the cards back.
    run.heal();
    await tap(owner.getByRole("link", { name: "Try again" }), "Try again (owner)");
    await see(card(owner, P1), "the first card, after Try again");
    await tap(member.getByRole("link", { name: "Try again" }), "Try again (member)");
    await see(card(member, P1), "the first card for a member, after Try again");
  },
};

// 2. Signed out

const signin: Check = {
  name: "signin",
  async run(run) {
    const { page } = await run.actor("nobody");
    await page.goto(`${run.base}/`, { waitUntil: "load" });
    await arrive(page, "the sign-in page", (url) => url.pathname === "/signin");
    await see(page.getByRole("heading", { level: 1 }).filter({ hasText: BRAND.name }), `the name ${BRAND.name} as the heading`);
    await see(page.getByRole("button", { name: "Sign in with Google" }), "the Sign in with Google button");
    if (await page.getByRole("navigation", { name: "Main" }).count()) throw new Error("The sign-in page shows the tab bar");
  },
};

// 3. The tab bar

const tabBar: Check = {
  name: "tab-bar",
  async run(run) {
    const { page } = await run.actor("owner");
    for (const [address, current] of [["/", "Month"], ["/activity", "Activity"], ["/more", "More"], ["/tenants/p1", "Month"]]) {
      await open(run, page, address);
      const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
      const count = await links.count();
      if (count !== TABS.length) throw new Error(`${address}: ${count} tabs, expected ${TABS.length}`);
      for (let at = 0; at < count; at += 1) {
        const tab = links.nth(at);
        const name = (await tab.innerText()).trim();
        const box = await tab.boundingBox();
        if (box === null || box.height < 44) throw new Error(`${address}: the ${name} tab is ${box?.height ?? 0} px high, under 44`);
        const mark = await tab.getAttribute("aria-current");
        if ((mark === "page") !== (name === current)) throw new Error(`${address}: the ${name} tab is ${mark === "page" ? "" : "not "}marked as the current one`);
      }
    }
  },
};

// 4. Back keeps the month

const backKeepsMonth: Check = {
  name: "back-keeps-month",
  async run(run) {
    const { beforeKey, beforeTitle } = months(run);
    const { page } = await run.actor("owner");
    const details = page.getByRole("link", { name: new RegExp(` for ${escape(P1)}$`) });
    const tabLink = (name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });
    const backOnMonth = async (what: string) => {
      await arrive(page, `${what}: the month screen of ${beforeTitle}`, onMonth(beforeKey));
      await see(title(page, beforeTitle), `${what}: the heading ${beforeTitle}`);
    };

    await open(run, page, "/");
    await tap(page.getByRole("button", { name: "Previous month" }), "the previous-month arrow");
    await backOnMonth("the arrow");
    // The arrow back on a tenant page.
    await tap(details, "the tenant page link");
    await arrive(page, "the tenant page, in that month", (url) => url.pathname === "/tenants/p1" && url.searchParams.get("month") === beforeKey);
    await tap(page.getByRole("link", { name: "Back to month" }), "the arrow back");
    await backOnMonth("the arrow back");
    // The system's Back.
    await tap(details, "the tenant page link, again");
    await arrive(page, "the tenant page, again", (url) => url.pathname === "/tenants/p1");
    await page.goBack();
    await backOnMonth("Back");
    // Another tab and the Month tab.
    await tap(tabLink("Activity"), "the Activity tab");
    await arrive(page, "Activity, in that month", (url) => url.pathname === "/activity" && url.searchParams.get("month") === beforeKey);
    await tap(tabLink("Month"), "the Month tab");
    await backOnMonth("the Month tab");
  },
};

// 5. The reports

const reports: Check = {
  name: "reports",
  async run(run) {
    const { key, beforeKey, beforeTitle } = months(run);
    const { page } = await run.actor("owner");
    await open(run, page, "/");
    // Needs attention, then Overdue rent, then a month in it.
    await tap(page.getByRole("link", { name: /^Rent overdue/ }), "the Rent overdue row of Needs attention");
    await arrive(page, "Overdue rent", (url) => url.pathname === "/overdue");
    await see(page.getByRole("heading", { level: 1, name: "Overdue rent" }), "the Overdue rent heading");
    const owes = page.locator("li").filter({ has: page.getByRole("heading", { name: P3, exact: true }) });
    await tap(owes.getByRole("link", { name: new RegExp(`^${escape(beforeTitle)}`) }), `${P3}'s ${beforeTitle} row`);
    await arrive(page, `${beforeTitle}'s month screen`, onMonth(beforeKey));
    await see(title(page, beforeTitle), `the heading ${beforeTitle}`);
    // Year at a glance, then a month in it.
    await tap(page.getByRole("link", { name: "Year at a glance" }), "Year at a glance");
    await arrive(page, "the Year screen", (url) => url.pathname === "/year");
    const cell = yearCellLabel({ month: addMonths(currentYm(run.now), -1), state: "paid", received: 5450, due: 5450 }, P1);
    await tap(page.getByRole("link", { name: cell }), `the year cell "${cell}"`);
    await arrive(page, `${beforeTitle} from the year`, onMonth(beforeKey));
    // Agreements and hikes, from the card on this month's screen.
    await open(run, page, "/");
    await tap(page.getByRole("link", { name: /agreement ended$/ }), "the agreement row of Needs attention");
    await arrive(page, "Agreements and hikes", (url) => url.pathname === "/alerts");
    const ended = page.locator("li").filter({ has: page.getByRole("heading", { name: P3, exact: true }) });
    await see(ended.getByText("Ended", { exact: true }), `Ended on ${P3}`);
    const hike = page.locator("li").filter({ has: page.getByRole("heading", { name: P2, exact: true }) });
    await see(hike.getByText("Next payment", { exact: true }), `Next payment on ${P2}`);
    // More, Set up, and back.
    await tap(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "More", exact: true }), "the More tab");
    await tap(page.getByRole("link", { name: /^Set up/ }), "Set up");
    await arrive(page, "Set up", (url) => url.pathname === "/setup" && url.searchParams.get("month") === key);
    const allGood = headline([{ id: "x", step: 1, title: "x", status: "ok", detail: "" }]);
    await see(page.getByText(allGood, { exact: true }), `"${allGood}" on Set up`);
    await tap(page.getByRole("link", { name: "Back to More" }), "the arrow back");
    await arrive(page, "More", (url) => url.pathname === "/more");
  },
};

// 6. A save that fails

const saveError: Check = {
  name: "save-error",
  async run(run) {
    run.expectsHttpError();
    const { page } = await run.actor("owner");
    await open(run, page, "/");
    const sheet = await openLog(page, P3);
    run.fail({ updateValues: "unavailable", cloneRow: "unavailable" });
    await tap(sheet.getByRole("button", { name: "Save to Sheet" }), "Save to Sheet");
    await see(sheet.getByText(unavailable().message), `"${unavailable().message}" in the sheet`);
    // The form is free again, and nothing was saved.
    if (await sheet.getByRole("button", { name: "Save to Sheet" }).isDisabled()) throw new Error("The form stays locked after a failed save");
    run.heal();
    await tap(sheet.getByRole("button", { name: "Close", exact: true }), "Close");
    await gone(dialog(page), "the sheet");
    await see(pill(page, P3, "Pending"), `${P3} still Pending`);
  },
};

// 7 to 10. Logging, undoing and replacing a payment

const logExisting: Check = {
  name: "log-existing",
  async run(run) {
    const { key, title: monthTitle } = months(run);
    void key;
    const { page } = await run.actor("owner");
    await open(run, page, "/");
    const sheet = await openLog(page, P2);
    const suggested = await sheet.getByLabel("Amount received (₹)").inputValue();
    if (suggested !== "13335") throw new Error(`The suggested amount is ${suggested}, expected 13335`);
    await tap(sheet.getByRole("button", { name: "Save to Sheet" }), "Save to Sheet");
    await toast(page, logToastText(P2, 13335, monthTitle));
    await see(pill(page, P2, "Paid"), `${P2} Paid`);
  },
};

const undo: Check = {
  name: "undo",
  needs: ["log-existing"],
  async run(run) {
    const { title: monthTitle } = months(run);
    const { page } = await run.actor("owner");
    await open(run, page, "/");
    await tap(card(page, P2).getByRole("button", { name: "Undo", exact: true }), `Undo on ${P2}`);
    const sheet = dialog(page);
    const asked = undoConfirmationText({ tenant: "Bala", count: 1, amount: 13335 } as Parameters<typeof undoConfirmationText>[0], P2, monthTitle);
    await see(sheet.getByText(asked), "the undo question");
    await tap(sheet.getByRole("button", { name: "Undo payment", exact: true }), "Undo payment");
    await toast(page, undoToastText(P2));
    await see(pill(page, P2, "Pending"), `${P2} Pending again`);
  },
};

const duplicateReplace: Check = {
  name: "duplicate-replace",
  needs: ["undo"],
  async run(run) {
    run.expectsHttpError();
    const { title: monthTitle } = months(run);
    const owner = (await run.actor("owner")).page;
    const member = (await run.actor("member")).page;
    // The owner's screen shows the month; then a member logs the same portion on theirs.
    await open(run, owner, "/");
    await see(pill(owner, P2, "Pending"), `${P2} Pending for the owner`);
    await open(run, member, "/");
    const theirs = await openLog(member, P2);
    await tap(theirs.getByRole("button", { name: "Save to Sheet" }), "Save to Sheet (member)");
    await toast(member, logToastText(P2, 13335, monthTitle));
    // The owner's screen is out of date: logging the same month warns instead of writing twice.
    const sheet = await openLog(owner, P2);
    await type(sheet.getByLabel("Amount received (₹)"), "13000", "the amount");
    await tap(sheet.getByRole("button", { name: "Save to Sheet" }), "Save to Sheet (owner)");
    await see(sheet.getByText(new RegExp(`already has ${escape(formatRupees(13335))} recorded for ${escape(monthTitle)}`)), "the duplicate warning");
    await tap(sheet.getByRole("button", { name: "Replace amount" }), "Replace amount");
    await toast(owner, replaceToastText(P2, 13000));
    await owner.reload();
    await ready(owner);
    await see(card(owner, P2).getByText(formatRupees(13000), { exact: true }), `${formatRupees(13000)} on ${P2} after a reload`);
  },
};

// 10 and 11. A new tenant, and a vacant portion

const newTenant: Check = {
  name: "new-tenant",
  async run(run) {
    const { page } = await run.actor("owner");
    await open(run, page, "/");
    await tap(page.getByRole("button", { name: "New tenant", exact: true }), "New tenant");
    const sheet = dialog(page);
    await see(sheet.getByRole("heading", { name: "New tenant" }), "the New tenant sheet");
    await sheet.locator("select").selectOption({ label: `${P4} (vacant)` });
    await type(sheet.getByLabel("Tenant name"), "Farah", "the tenant's name");
    await type(sheet.getByLabel("Amount received (₹)"), "7000", "the amount");
    await tap(sheet.getByRole("button", { name: "Save to Sheet" }), "Save to Sheet");
    await toast(page, newTenantToastText(P4, "Farah", 7000));
    await see(card(page, P4).getByText(/^Farah · Payment 1\b/), `Farah at payment 1 on ${P4}`);
    await see(pill(page, P4, "Paid"), `${P4} Paid`);
  },
};

const vacant: Check = {
  name: "vacant",
  async run(run) {
    const { key } = months(run);
    const { page } = await run.actor("owner");
    await open(run, page, "/");
    const since = `Vacant since ${formatDay(firstDayOf({ year: Number(key.slice(0, 4)), month: Number(key.slice(5)) }))}.`;
    await see(card(page, P5).getByText(since), `"${since}" on ${P5}`);
    await tap(card(page, P5).getByRole("button", { name: "Add tenant" }), `Add tenant on ${P5}`);
    const sheet = dialog(page);
    await see(sheet.getByRole("heading", { name: "New tenant" }), "the New tenant sheet");
    const chosen = await sheet.locator("select").inputValue();
    if (chosen !== "p5") throw new Error(`The sheet chose ${chosen}, expected p5`);
    await tap(sheet.getByRole("button", { name: "Close", exact: true }), "Close");
    await gone(dialog(page), "the sheet");
    // Nothing was saved: after a reload the portion is still vacant.
    await page.reload();
    await ready(page);
    await see(card(page, P5).getByText(since), `${P5} still vacant after a reload`);
  },
};

// 12 and 13. Tenant details, and a move-out

const editTenancy: Check = {
  name: "edit-tenancy",
  async run(run) {
    const { today } = months(run);
    const { page } = await run.actor("owner");
    const was = addDays(today, 30);
    const now = addDays(today, 90);
    await open(run, page, "/");
    await tap(page.getByRole("link", { name: new RegExp(`^Details for ${escape(P1)}$`) }), `Details on ${P1}`);
    await arrive(page, "the tenant page", (url) => url.pathname === "/tenants/p1");
    await ready(page);
    const changed = page.getByText("Details changed for Asha.", { exact: true });
    const before = await changed.count();
    await tap(page.getByRole("button", { name: "Edit tenancy details" }), "Edit");
    await type(page.getByLabel("Agreement end"), now, "the agreement end");
    await tap(page.getByRole("button", { name: "Save details" }), "Save details");
    await toast(page, DETAILS_SAVED_TOAST);
    await see(page.locator("dl").getByText(formatDay(now), { exact: true }), `the new date ${formatDay(now)}`);
    await until("a new entry in History", async () => (await changed.count()) === before + 1);
    await see(page.getByText(`Agreement end changed from ${formatDay(was)} to ${formatDay(now)}.`, { exact: true }), "the changed date in History");
  },
};

const moveOut: Check = {
  name: "move-out",
  async run(run) {
    const { today } = months(run);
    const { page } = await run.actor("owner");
    await open(run, page, "/tenants/p3");
    await tap(page.getByRole("button", { name: "Move out Chitra" }), "Move out");
    await tap(page.getByRole("button", { name: "Record move-out" }), "Record move-out");
    await toast(page, moveOutToastText("Chitra", P3, today));
    // The month the toast names shows the portion vacant.
    const vacantFrom = ymKey(firstVacantMonth(today));
    await open(run, page, vacantFrom === months(run).key ? "/" : `/?month=${vacantFrom}`);
    await see(pill(page, P3, "Vacant"), `${P3} Vacant in ${vacantFrom}`);
  },
};

// 14. The Activity filters

const activityFilters: Check = {
  name: "activity-filters",
  needs: ["duplicate-replace", "new-tenant"],
  async run(run) {
    const { key, today } = months(run);
    const { page } = await run.actor("owner");
    const entry = (action: "Logged" | "Edited" | "Undone", portion: string, tenant: string, amount: number, count: number) =>
      toActivityEntry({ savedAt: new Date().toISOString(), month: key, portion, tenant, amount, count, dateReceived: today, loggedBy: OWNER, action }, OWNER).summary;
    await open(run, page, "/activity");
    // The entries of today's journeys are listed under Today.
    const everything = await text(page);
    for (const sentence of [
      entry("Logged", P2, "Bala", 13335, 1),
      entry("Undone", P2, "Bala", 13335, 1),
      entry("Edited", P2, "Bala", 13000, 1),
      entry("Logged", P4, "Farah", 7000, 1),
    ]) {
      if (!everything.includes(sentence)) throw new Error(`Activity does not list "${sentence}"`);
    }
    const entries = page.locator("section ol > li");
    const group = (name: string) => page.getByRole("group", { name });
    // Undone: only those, and the choice is in the address.
    await tap(group("Show").getByRole("link", { name: "Undone", exact: true }), "the Undone chip");
    await arrive(page, "show=undone in the address", (url) => url.searchParams.get("show") === "undone");
    await until("only Undid entries", async () => {
      const texts = await entries.allInnerTexts();
      return texts.length > 0 && texts.every((entryText) => entryText.includes("Undid"));
    });
    // Then one portion.
    await tap(group("Portion").getByRole("link", { name: P2, exact: true }), `the ${P2} chip`);
    await arrive(page, "the portion in the address", (url) => url.searchParams.get("portion") === P2 && url.searchParams.get("show") === "undone");
    await until(`only ${P2}'s Undid entries`, async () => {
      const texts = await entries.allInnerTexts();
      return texts.length > 0 && texts.every((entryText) => entryText.includes("Undid") && entryText.includes(P2));
    });
    // A portion with no undone entry leaves nothing, and Show everything resets both choices.
    await tap(group("Portion").getByRole("link", { name: P5, exact: true }), `the ${P5} chip`);
    await see(page.getByText("No entries match these filters"), "the empty result");
    await tap(page.getByRole("link", { name: "Show everything" }), "Show everything");
    await arrive(page, "the plain Activity address", (url) => isPlainActivityAddress(url, key));
    await until("every kind and portion chosen again", async () => (await group("Show").getByRole("link", { name: "All", exact: true }).getAttribute("aria-current")) === "true");
    if ((await group("Portion").getByRole("link", { name: "All portions", exact: true }).getAttribute("aria-current")) !== "true") throw new Error("All portions is not chosen again");
  },
};

// 15. Portion settings

const settings: Check = {
  name: "settings",
  async run(run) {
    const owner = (await run.actor("owner")).page;
    await open(run, owner, "/more");
    await tap(owner.getByRole("link", { name: /^Portion settings/ }), "Portion settings");
    await arrive(owner, "Portion settings", (url) => url.pathname === "/settings");
    await ready(owner);
    const hike = () => owner.getByRole("group", { name: `Settings for ${P1}` }).getByLabel("Hike at each new cycle (%)");
    if ((await hike().inputValue()) !== "5") throw new Error(`${P1}'s hike is ${await hike().inputValue()}, expected 5`);
    await type(hike(), "6", "the hike");
    await tap(owner.getByRole("button", { name: "Save settings" }), "Save settings");
    await toast(owner, SETTINGS_SAVED_TOAST);
    await owner.reload();
    await ready(owner);
    if ((await hike().inputValue()) !== "6") throw new Error(`After a reload ${P1}'s hike is ${await hike().inputValue()}, expected 6`);
    // A member has no Portion settings: they land on the month screen.
    const member = (await run.actor("member")).page;
    await member.goto(`${run.base}/settings`, { waitUntil: "load" });
    await arrive(member, "the member's month screen", (url) => url.pathname === "/");
  },
};

// 16. The longest names, at phone width

const longNames: Check = {
  name: "long-names",
  async run(run) {
    const { page } = await run.actor("owner");
    // The longest portion name, through Portion settings, and the longest tenant name, through New tenant.
    await open(run, page, "/settings");
    await type(page.getByRole("group", { name: `Settings for ${P1}` }).getByLabel("Portion name"), LONG_PORTION, "the portion name");
    await tap(page.getByRole("button", { name: "Save settings" }), "Save settings");
    await toast(page, SETTINGS_SAVED_TOAST);
    await open(run, page, "/");
    await tap(card(page, P5).getByRole("button", { name: "Add tenant" }), `Add tenant on ${P5}`);
    const sheet = dialog(page);
    await see(sheet.getByRole("heading", { name: "New tenant" }), "the New tenant sheet");
    await type(sheet.getByLabel("Tenant name"), LONG_TENANT, "the tenant's name");
    await type(sheet.getByLabel("Amount received (₹)"), "5100", "the amount");
    await tap(sheet.getByRole("button", { name: "Save to Sheet" }), "Save to Sheet");
    await toast(page, newTenantToastText(P5, LONG_TENANT, 5100));
    // None of the screens that name them runs off the side of the phone.
    for (const [address, shows] of [
      ["/", [LONG_PORTION, LONG_TENANT]],
      ["/tenants/p1", [LONG_PORTION]],
      ["/tenants/p5", [P5, LONG_TENANT]],
      ["/year", [LONG_PORTION]],
      // (the agreement of the first portion was moved out of the alert window by edit-tenancy)
      ["/alerts", []],
      ["/overdue", []],
      ["/activity", []],
      ["/settings", []],
    ] as Array<[string, string[]]>) {
      await open(run, page, address);
      const width = await page.evaluate<number>("document.documentElement.scrollWidth");
      if (width > PHONE_WIDTH) throw new Error(`${address} is ${width} px wide with the longest names, wider than the ${PHONE_WIDTH} px screen`);
      const shown = await text(page);
      for (const name of shows) if (!shown.includes(name)) throw new Error(`${address} does not show "${name}"`);
    }
  },
};

export const CHECKS: readonly Check[] = [
  loadError,
  sweep,
  signin,
  tabBar,
  backKeepsMonth,
  reports,
  saveError,
  logExisting,
  undo,
  duplicateReplace,
  newTenant,
  vacant,
  editTenancy,
  moveOut,
  activityFilters,
  settings,
  longNames,
];
