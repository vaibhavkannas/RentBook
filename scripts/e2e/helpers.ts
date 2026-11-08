import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { encode } from "next-auth/jwt";

/**
 * The pure parts of the end-to-end runner (run.ts): finding Playwright, the dummy settings, the session cookies, copying the
 * app, the report, the options. Nothing here starts a process or opens a browser, and nothing imports Playwright, which
 * lives outside this project (see findPlaywright), so each piece can be tested.
 */

// Finding Playwright

export const INSTALL_HINT =
  "Playwright isn't installed. Install it outside this project with `npm install -g playwright`, then `npx playwright install chromium`, or set E2E_PLAYWRIGHT to the folder of the playwright package.";

/** Where the tools folder of the machine this was written on keeps it: the last place looked. */
export const KNOWN_PLAYWRIGHT = "/opt/node-tools/node_modules/playwright";

/**
 * The folder of the `playwright` package: the one E2E_PLAYWRIGHT names (when it is set and there is no package there, nothing
 * else is tried: the person pointed at it on purpose), then the global npm folder (`globalRoot`, from `npm root -g`), then the
 * known tools folder. A message, with how to install it, when there is none.
 */
export function findPlaywright(options: {
  explicit: string | undefined;
  globalRoot: string | null;
  exists: (file: string) => boolean;
}): { dir: string } | { message: string } {
  const has = (dir: string) => options.exists(path.join(dir, "package.json"));
  const explicit = options.explicit?.trim();
  if (explicit) {
    return has(explicit)
      ? { dir: explicit }
      : { message: `E2E_PLAYWRIGHT is set to ${explicit}, but there is no playwright package there. ${INSTALL_HINT}` };
  }
  const candidates = [options.globalRoot === null ? null : path.join(options.globalRoot, "playwright"), KNOWN_PLAYWRIGHT];
  for (const dir of candidates) if (dir !== null && has(dir)) return { dir };
  return { message: INSTALL_HINT };
}

// The settings of the server under test

/** Every setting the app reads from its environment (and the run's own control file), so none the machine has can change a run. */
export const APP_VARIABLES: readonly string[] = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_URL",
  "AUTH_TRUST_HOST",
  "NEXTAUTH_URL",
  "ALLOWED_EMAILS",
  "ALLOWED_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "SHEET_ID",
  "SCHEDULE_TAB",
  "SETTINGS_TAB",
  "LOG_TAB",
  "TENANTS_TAB",
  "TENANCY_LOG_TAB",
  "TOTAL_HEADER",
  "SESSION_NOT_BEFORE",
  "CSP_REPORT_ONLY",
  "E2E_CONTROL",
];

type Env = Record<string, string | undefined>;

/**
 * Made-up settings for one run: nothing in them can reach Google or open a real account. The secrets are random, so a run can
 * look for them (the canaries, by name) in every page and in the server's output, where they must never be.
 */
export function dummyEnv(random: (bytes: number) => Buffer): { env: Record<string, string>; canaries: Record<string, string> } {
  const hex = (bytes: number) => random(bytes).toString("hex");
  const authSecret = hex(32);
  const googleSecret = `e2e-google-secret-${hex(12)}`;
  const keyBody = hex(24);
  const sheetId = "e2e-not-a-real-sheet";
  const env: Record<string, string> = {
    AUTH_SECRET: authSecret,
    AUTH_GOOGLE_ID: "e2e-client-id.apps.example.com",
    AUTH_GOOGLE_SECRET: googleSecret,
    AUTH_TRUST_HOST: "true",
    ALLOWED_EMAILS: "owner@example.com, member@example.com",
    SHEET_ID: sheetId,
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: "service_account",
      client_email: "e2e-sheets@example.com",
      private_key: `-----BEGIN PRIVATE KEY-----\n${keyBody}\n-----END PRIVATE KEY-----\n`,
    }),
    TOTAL_HEADER: "Total Rent",
  };
  return { env, canaries: { AUTH_SECRET: authSecret, AUTH_GOOGLE_SECRET: googleSecret, PRIVATE_KEY: keyBody, SHEET_ID: sheetId } };
}

/** The environment for the server: `base` (the machine's) without any setting of the app, plus the dummy ones. */
export function serverEnv(base: Env, dummy: Record<string, string>): Env {
  const kept: Env = { ...base };
  for (const name of APP_VARIABLES) delete kept[name];
  return { ...kept, ...dummy };
}

// Signed-in people

/** The cookie Auth.js reads on http (on https it is prefixed). Its name is also the salt the session is encoded with. */
export const SESSION_COOKIE = "authjs.session-token";

/** A session cookie for `email`, as Auth.js makes one at sign-in: encoded with the run's AUTH_SECRET, signed in at `now`. */
export async function sessionCookie(email: string, secret: string, now: number): Promise<{ name: string; value: string }> {
  const name = email.split("@")[0];
  const value = await encode({
    token: { name, email, sub: email, issuedAt: now },
    secret,
    salt: SESSION_COOKIE,
    maxAge: 24 * 60 * 60,
  });
  return { name: SESSION_COOKIE, value };
}

// The temporary copy of the app

/** What the copy of the app is made of (relative to the project): what a build needs, and the in-memory Sheet. Nothing of the machine's own. */
export const COPY_LIST: readonly string[] = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "src",
  "public",
  "tests/support",
  "scripts/e2e/sheet.ts",
];

type Link = (existing: fs.PathLike, created: fs.PathLike) => void;

/**
 * Copies `from` to `to` as hard links, so a tree as large as node_modules takes a moment and no room. Where a link cannot be
 * made (another drive, a file system that has none) the file is copied. A link to a file in the tree stays a link, so a `.bin`
 * still points where it did; one the system will not let be made is left out (it is only a shortcut). Any other failure is
 * raised. A symlink instead of a hard-link tree breaks `next build`: it points out of the project.
 */
export function linkTree(from: string, to: string, link: Link = fs.linkSync): void {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.symlinkSync(fs.readlinkSync(from), to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) linkTree(path.join(from, name), path.join(to, name), link);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    link(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM") throw error;
    fs.copyFileSync(from, to);
  }
}

// The report

export type CheckResult = { name: string; ok: boolean; seconds: number; reason?: string; screenshot?: string };

/** A reason on one line, whatever it was made of, short enough to read. */
const oneLine = (reason: string) => {
  const text = reason.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
};

/** The lines of the report ("PASS  name (1.2 s)", "FAIL  name: reason. Screenshot: path", then the counts), and the exit code: 0 when all passed. */
export function report(results: readonly CheckResult[]): { text: string; exitCode: 0 | 1 } {
  const lines = results.map((result) => {
    if (result.ok) return `PASS  ${result.name} (${result.seconds.toFixed(1)} s)`;
    const reason = oneLine(result.reason ?? "It failed").replace(/\.$/, "");
    return `FAIL  ${result.name}: ${reason}.${result.screenshot ? ` Screenshot: ${result.screenshot}` : ""}`;
  });
  const failed = results.filter((result) => !result.ok).length;
  lines.push(`${results.length - failed} passed, ${failed} failed.`);
  return { text: lines.join("\n"), exitCode: failed > 0 || results.length === 0 ? 1 : 0 };
}

// The options and the choice of checks

export type Options = { ok: true; keep: boolean; only: string[] | null; shots: string | null } | { ok: false; message: string };

/** `--keep`, `--only a,b` and `--shots <folder>` (npm passes them after `--`). */
export function parseArgs(argv: readonly string[]): Options {
  let keep = false;
  let only: string[] | null = null;
  let shots: string | null = null;
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (arg === "--keep") {
      keep = true;
    } else if (arg === "--only" || arg === "--shots") {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, message: `${arg} needs a value.` };
      at += 1;
      if (arg === "--only") only = value.split(",").map((name) => name.trim()).filter(Boolean);
      else shots = value;
    } else {
      return { ok: false, message: `Unknown option "${arg}". Use --keep, --only a,b or --shots <folder>.` };
    }
  }
  return { ok: true, keep, only, shots };
}

/**
 * The checks to run, in the order of the run. `only` names some; each brings the checks it `needs` first (all the way back), so a
 * check that expects data an earlier one made starts from it. A name that is not a check is refused.
 */
export function selectChecks(
  all: ReadonlyArray<{ name: string; needs?: readonly string[] }>,
  only: readonly string[] | null,
): { ok: true; names: string[] } | { ok: false; message: string } {
  const known = all.map((check) => check.name);
  if (only === null) return { ok: true, names: known };
  const wanted = new Set<string>();
  const add = (name: string) => {
    if (wanted.has(name)) return;
    wanted.add(name);
    for (const need of all.find((check) => check.name === name)?.needs ?? []) add(need);
  };
  for (const name of only) {
    if (!known.includes(name)) return { ok: false, message: `There is no check called "${name}". The checks are: ${known.join(", ")}.` };
    add(name);
  }
  return { ok: true, names: known.filter((name) => wanted.has(name)) };
}

// An address the checks wait for

/**
 * The Activity screen with no choice made: `/activity`, with no filter in the address, and with or without the month the person
 * came from (`?month=KEY`). Any other screen, and any filter that is still set, is not.
 */
export function isPlainActivityAddress(url: URL, monthKey: string): boolean {
  return url.pathname === "/activity" && (url.search === "" || url.search === `?month=${monthKey}`);
}

// Stopping the run: what is cleaned up, and how a server dies with the runner

/** The signals the runner stops cleanly on: Ctrl-C, a request to end, and a closed terminal. */
export const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
export type Interrupt = (typeof SIGNALS)[number];

/** The exit code of a run that a signal stopped: 128 plus the signal's number, as a shell reports it. */
export function signalExitCode(signal: Interrupt): number {
  return 128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal];
}

/** `work` runs the first time it is asked for, and every later ask (even while it runs) gets the same answer: a second signal does not clean up twice. */
export function once<T>(work: () => Promise<T>): () => Promise<T> {
  let started: Promise<T> | undefined;
  return () => (started ??= work());
}

export type CleanupStep = { name: string; run: () => unknown };

/**
 * Cleans up after a run, whether it ended or was stopped: each step in turn (the browser, the build, the server), then the
 * temporary copy, which goes last because the server may hold files in it, and only when `keepFolder` is false. A step that fails
 * is named in `problems` and does not stop the others; this never throws.
 */
export async function runCleanup(options: {
  steps: readonly CleanupStep[];
  removeFolder: () => unknown;
  keepFolder: boolean;
}): Promise<{ removed: boolean; problems: string[] }> {
  const problems: string[] = [];
  const why = (error: unknown) => (error instanceof Error ? error.message : String(error));
  for (const step of options.steps) {
    try {
      await step.run();
    } catch (error) {
      problems.push(`${step.name}: ${why(error)}`);
    }
  }
  if (options.keepFolder) return { removed: false, problems };
  try {
    await options.removeFolder();
    return { removed: true, problems };
  } catch (error) {
    problems.push(`the temporary copy: ${why(error)}`);
    return { removed: false, problems };
  }
}

/** What `killTree` needs of the system: which one it is, a signal to a process, and the Windows tool that ends a process and its children. */
export type TreeIo = {
  platform: NodeJS.Platform;
  kill: (pid: number, signal: NodeJS.Signals | 0) => void;
  taskkill: (pid: number) => void;
};

const systemIo: TreeIo = {
  platform: process.platform,
  kill: (pid, signal) => void process.kill(pid, signal),
  taskkill: (pid) => void spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }),
};

/**
 * Signals a process and everything it started: the whole process group (a negative number) where there are groups, so the
 * server's own children go too, and taskkill's tree on Windows. `signal` 0 only asks whether it is there. False when nothing is
 * left to signal; any other failure is raised.
 */
export function killTree(pid: number, signal: NodeJS.Signals | 0, io: TreeIo = systemIo): boolean {
  try {
    if (io.platform === "win32") {
      if (signal === 0) io.kill(pid, 0);
      else io.taskkill(pid);
    } else {
      io.kill(-pid, signal);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

/**
 * Ends a tree: `terminate` asks, and when `gone` says the tree has not ended after `timeoutMs`, `force` makes it. "stopped" when
 * it ended by itself, "killed" when it had to be forced. `sleep` is how it waits, so a test need not.
 */
export async function stopTree(options: {
  terminate: () => void;
  force: () => void;
  gone: () => boolean;
  sleep: (milliseconds: number) => Promise<void>;
  timeoutMs: number;
}): Promise<"stopped" | "killed"> {
  options.terminate();
  for (let waited = 0; waited < options.timeoutMs; waited += 100) {
    if (options.gone()) return "stopped";
    await options.sleep(100);
  }
  if (options.gone()) return "stopped";
  options.force();
  return "killed";
}

/**
 * A small program, run with `node -e`, that starts a command and stays beside it: it looks for the runner that started it every
 * so often, and when the runner is gone (killed hard, so nothing of the runner's own cleanup ran) it ends the command and
 * everything the command started, so no server is left behind. The runner starts it as the leader of its own process group, so
 * one signal to the group reaches all of it. It ends with the command's exit code. Arguments: the runner's pid, how often to
 * look in milliseconds, then the command and its arguments.
 */
export const WATCHDOG = `
const { spawn, spawnSync } = require("node:child_process");
const [parent, every, command, ...args] = process.argv.slice(1);
const child = spawn(command, args, { stdio: "inherit" });
const endAll = (signal) => {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-process.pid, signal);
  } catch (error) {}
  try { child.kill(signal); } catch (error) {}
};
child.on("exit", (code) => process.exit(code === null ? 1 : code));
child.on("error", () => process.exit(1));
setInterval(() => {
  try {
    process.kill(Number(parent), 0);
  } catch (error) {
    if (error.code === "ESRCH") {
      endAll("SIGKILL");
      process.exit(1);
    }
  }
}, Number(every));
let asked = false;
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    try { child.kill(signal); } catch (error) {}
    if (asked) return;
    asked = true;
    setTimeout(() => { endAll("SIGKILL"); process.exit(1); }, 4000);
  });
}
`;

/** The arguments to start `node` with, to run `command` under the WATCHDOG, watching the runner with this pid. */
export function watched(runnerPid: number, command: readonly string[], everyMs = 500): string[] {
  return ["-e", WATCHDOG, String(runnerPid), String(everyMs), ...command];
}

// What the browser and the server say

/** Whether a request stays on the local server (its own port, on localhost or 127.0.0.1), or makes none (data:, blob: and about: addresses). */
export function isLocalRequest(url: string, port: number): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "about:") return true;
  if (parsed.protocol === "blob:") return isLocalRequest(parsed.pathname, port);
  return (
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
    parsed.port === String(port)
  );
}

/** How many `<script>` tags of a page's HTML carry no nonce: the page's Content-Security-Policy runs only scripts that have one. */
export function scriptsWithoutNonce(html: string): number {
  return (html.match(/<script(?=[\s>])[^>]*>/gi) ?? []).filter((tag) => !/\snonce=/i.test(tag)).length;
}

/** The last `count` lines of a text, with the empty lines at its end left off. */
export function lastLines(text: string, count: number): string {
  return text.replace(/\s+$/, "").split("\n").slice(-count).join("\n");
}

/** The names of the canaries a text holds. Never the text or the value: a leak must not be repeated in the report. */
export function leaked(text: string, canaries: Record<string, string>): string[] {
  return Object.entries(canaries)
    .filter(([, value]) => text.includes(value))
    .map(([name]) => name);
}

/**
 * Whether a line the browser wrote to its console is a problem: an error is. The browser's own "Failed to load resource" line
 * for an HTTP error answer is not, in a check that expects one (a page that was not found, a save the fake Sheet refuses).
 */
export function consoleProblem(message: { type: string; text: string }, expectsHttpError: boolean): boolean {
  if (message.type !== "error") return false;
  return !(expectsHttpError && message.text.startsWith("Failed to load resource"));
}

// The parts of Playwright that the runner uses

/**
 * Playwright is found at run time and is not a dependency, so its types are not at hand: these are the few parts the runner
 * and the checks call, written out so that the project still type-checks without it.
 */
export type PwBox = { x: number; y: number; width: number; height: number };

export interface PwLocator {
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  selectOption(value: string | { label: string }): Promise<unknown>;
  waitFor(options?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  first(): PwLocator;
  last(): PwLocator;
  nth(index: number): PwLocator;
  filter(options: { hasText?: string | RegExp; has?: PwLocator }): PwLocator;
  locator(selector: string): PwLocator;
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean; level?: number }): PwLocator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): PwLocator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): PwLocator;
  isVisible(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  innerText(options?: { timeout?: number }): Promise<string>;
  allInnerTexts(): Promise<string[]>;
  inputValue(options?: { timeout?: number }): Promise<string>;
  getAttribute(name: string, options?: { timeout?: number }): Promise<string | null>;
  boundingBox(options?: { timeout?: number }): Promise<PwBox | null>;
  focus(): Promise<void>;
  press(key: string): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
}

export interface PwResponse {
  status(): number;
  text(): Promise<string>;
  url(): string;
  headers(): Record<string, string>;
}

export interface PwRoute {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(): Promise<void>;
}

export interface PwConsoleMessage {
  type(): string;
  text(): string;
}

export interface PwPage {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"; timeout?: number }): Promise<PwResponse | null>;
  goBack(options?: { timeout?: number }): Promise<PwResponse | null>;
  reload(options?: { timeout?: number }): Promise<PwResponse | null>;
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  locator(selector: string): PwLocator;
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean; level?: number }): PwLocator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): PwLocator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): PwLocator;
  /** Runs a JavaScript expression in the page. A string, not a function: the runner is compiled, and a compiled function can carry helpers the page does not have. */
  evaluate<R>(expression: string): Promise<R>;
  waitForURL(url: string | RegExp | ((url: URL) => boolean), options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "commit" }): Promise<void>;
  waitForFunction(expression: string, options?: { timeout?: number }): Promise<unknown>;
  waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle", options?: { timeout?: number }): Promise<void>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  on(event: "console", handler: (message: PwConsoleMessage) => void): void;
  on(event: "pageerror", handler: (error: Error) => void): void;
  close(): Promise<void>;
}

export interface PwContext {
  newPage(): Promise<PwPage>;
  addCookies(cookies: Array<{ name: string; value: string; url?: string; domain?: string; path?: string; httpOnly?: boolean; sameSite?: "Lax" | "Strict" | "None" }>): Promise<void>;
  addInitScript(script: string): Promise<void>;
  setDefaultTimeout(milliseconds: number): void;
  setDefaultNavigationTimeout(milliseconds: number): void;
  exposeFunction(name: string, callback: (...args: string[]) => void): Promise<void>;
  route(url: string | RegExp, handler: (route: PwRoute) => void | Promise<void>): Promise<void>;
  close(): Promise<void>;
}

export interface PwBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
    isMobile?: boolean;
    hasTouch?: boolean;
    deviceScaleFactor?: number;
    colorScheme?: "light" | "dark";
  }): Promise<PwContext>;
  close(): Promise<void>;
}

export interface PwChromium {
  launch(options?: { headless?: boolean; handleSIGINT?: boolean; handleSIGTERM?: boolean; handleSIGHUP?: boolean }): Promise<PwBrowser>;
}

/** The phone the run pretends to be: 390 by 844. */
export const PHONE = { width: 390, height: 844 } as const;
