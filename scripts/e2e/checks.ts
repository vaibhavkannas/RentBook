import path from "node:path";
import { addMonths, currentYm, ymKey } from "@/lib/domain/year-month";
import { leaked, scriptsWithoutNonce, type PwPage, type PwContext } from "./helpers";

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

export const CHECKS: readonly Check[] = [sweep];
