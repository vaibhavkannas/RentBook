/**
 * An on-demand end-to-end run of the real app, in a phone-sized Chromium, without touching Google.
 *
 *   npm run e2e [-- --keep] [--only sweep,undo] [--shots <folder>]
 *
 * It makes a temporary copy of the app, puts an in-memory Sheet in the copy (scripts/e2e/sheet.ts), builds the copy and starts it
 * with made-up settings, and drives Chromium at 390 by 844 through every page and the main journeys (checks.ts). The two people
 * are signed in with cookies the run makes itself, so Google's sign-in is never used. The browser refuses every request that is not to the local server, so a run never reaches the Google Sheets API or any
 * Google account, and the copy of the app talks only to the in-memory Sheet. (The build of the copy downloads the Inter and Space Grotesk fonts from
 * Google Fonts, with no credentials.) Playwright is not a dependency: it is installed outside this project (see findPlaywright
 * in helpers.ts). Not part of CI, which has no browser.
 *
 * Exit code: 0 all checks passed, 1 a check failed, 2 the run could not start (no Playwright, a failed build, a server that did not
 * come up), 130 or 143 the run was stopped by Ctrl-C or by a request to end. However it ends, the server (and what it started) is
 * stopped and the temporary copy is deleted, unless a check failed or --keep was given. The build and the server run under a small
 * watchdog (WATCHDOG in helpers.ts), so that even a runner that is killed hard leaves no server behind.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { CHECKS, type Actor, type Run, type Scheme, type Who } from "./checks";
import {
  COPY_LIST,
  dummyEnv,
  findPlaywright,
  isLocalRequest,
  killTree,
  lastLines,
  leaked,
  linkTree,
  once,
  parseArgs,
  PHONE,
  consoleProblem,
  report,
  runCleanup,
  selectChecks,
  serverEnv,
  SIGNALS,
  sessionCookie,
  signalExitCode,
  stopTree,
  watched,
  type CheckResult,
  type CleanupStep,
  type Interrupt,
  type PwBrowser,
  type PwChromium,
} from "./helpers";

const ROOT = path.resolve(__dirname, "../..");
const NEXT = path.join("node_modules", "next", "dist", "bin", "next");
const GATEWAY_LINE = 'export { createGateway } from "../../../scripts/e2e/sheet";\n';

/** The run could not start: its message is printed and the exit code is 2. */
class SetupFailure extends Error {}

const say = (text: string) => process.stdout.write(`${text}\n`);

/** `npm root -g`, or null where npm does not answer. */
function globalRoot(): string | null {
  const asked = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" });
  return asked.status === 0 && asked.stdout.trim() !== "" ? asked.stdout.trim() : null;
}

/** A port nothing listens on, from the system. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** The status of an address on the local server, or 0 when nothing answers. */
function statusOf(port: number, pathname: string): Promise<number> {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 2000 }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", () => resolve(0));
    request.on("timeout", () => {
      request.destroy();
      resolve(0);
    });
  });
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Lets the event loop run, so a signal (and tsx, which ends a child that is slow to answer one) is handled in the middle of a long job. */
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Copies `from` to `to` as a real copy, a piece at a time: the folders down to `depth` are walked here with the event loop let
 * run between pieces, and what is below is copied in one go. A real copy, not a link: the gateway module below is rewritten, which
 * would change the project's own file through a hard link. The tests of the support files are not needed to build.
 */
async function copyInPieces(from: string, to: string, depth: number): Promise<void> {
  if (depth > 0 && fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) await copyInPieces(path.join(from, name), path.join(to, name), depth - 1);
    return;
  }
  fs.cpSync(from, to, { recursive: true, filter: (file) => !file.endsWith(".test.ts") });
  await yieldToLoop();
}

/** The same for the hard-link tree of node_modules (the biggest package, next, takes about a tenth of a second in one go). */
async function linkInPieces(from: string, to: string, depth: number): Promise<void> {
  if (depth > 0 && fs.lstatSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) await linkInPieces(path.join(from, name), path.join(to, name), depth - 1);
    return;
  }
  linkTree(from, to);
  await yieldToLoop();
}

/** Fills the temporary copy of the app, with the in-memory Sheet in it. */
async function fillCopy(copy: string): Promise<void> {
  for (const entry of COPY_LIST) await copyInPieces(path.join(ROOT, entry), path.join(copy, entry), 3);
  await linkInPieces(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"), 3);
  const gateway = path.join(copy, "src", "lib", "server", "gateway-source.ts");
  if (fs.statSync(gateway).ino === fs.statSync(path.join(ROOT, "src", "lib", "server", "gateway-source.ts")).ino) {
    throw new SetupFailure("The copy shares a file with the project, so the Sheet was not swapped. Nothing was changed.");
  }
  fs.writeFileSync(gateway, GATEWAY_LINE);
  if (fs.readFileSync(gateway, "utf8") !== GATEWAY_LINE) throw new SetupFailure("The in-memory Sheet did not go into the copy.");
}

/** A process of the run (the build, the server) under the watchdog, in its own process group: how to read it and how to end all of it. */
type Launched = { name: string; output: () => string; done: Promise<number | null>; hasExited: () => boolean; stop(): Promise<void> };

/** What the run has started, so that a signal and the end of the run can stop all of it and delete the copy. */
const session: { browser: PwBrowser | null; launched: Launched[]; folder: string | null; keepFolder: boolean } = {
  browser: null,
  launched: [],
  folder: null,
  keepFolder: false,
};

/** The signal that stopped the run, if one did. */
let interrupted: Interrupt | null = null;

/**
 * Starts `node args...` in `cwd` as the leader of its own process group, under the watchdog: if this runner is killed hard, the
 * watchdog sees it is gone and ends the command and everything it started. A Ctrl-C at the terminal goes to this process alone,
 * which then stops it (see `cleanup`).
 */
function launch(name: string, cwd: string, args: string[], env: NodeJS.ProcessEnv): Launched {
  const child = spawn(process.execPath, watched(process.pid, [process.execPath, ...args]), {
    cwd,
    env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid!;
  let output = "";
  let exited = false;
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 4_000_000) output = output.slice(-2_000_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const done = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      exited = true;
      resolve(code);
    });
  });
  const launched: Launched = {
    name,
    output: () => output,
    done,
    hasExited: () => exited,
    // The watchdog may be gone while something it started is not (a server that forked), so the group is looked at, not the watchdog.
    stop: async () => {
      await stopTree({
        terminate: () => void killTree(pid, "SIGTERM"),
        force: () => void killTree(pid, "SIGKILL"),
        gone: () => !killTree(pid, 0),
        sleep: pause,
        timeoutMs: 6000,
      });
      await Promise.race([done, pause(1000)]);
    },
  };
  session.launched.push(launched);
  // The last resort, for a run that ends without its cleanup (an exit nobody planned): nothing may outlive it.
  process.once("exit", () => {
    try {
      killTree(pid, "SIGKILL");
    } catch {
      // gone, or not ours to signal
    }
  });
  return launched;
}

/** Ends the browser, the build and the server, and deletes the temporary copy unless it is to be kept. Does it once, however often it is asked. */
const cleanup = once(() => {
  const steps: CleanupStep[] = [
    { name: "the browser", run: () => session.browser?.close() },
    ...[...session.launched].reverse().map((launched) => ({ name: `the ${launched.name}`, run: () => launched.stop() })),
  ];
  return runCleanup({
    steps,
    // Not rmSync: a long job that blocks the event loop is where tsx, which runs this, ends a child that is slow to answer a signal.
    removeFolder: () => (session.folder === null ? undefined : fs.promises.rm(session.folder, { recursive: true, force: true })),
    keepFolder: session.keepFolder || session.folder === null,
  });
});

/** The run is stopped (Ctrl-C, a request to end, a closed terminal): stop what it started, delete the copy and leave with the shell's code for that signal. */
for (const signal of SIGNALS) {
  process.on(signal, () => {
    if (interrupted !== null) return;
    interrupted = signal;
    say(`\n${signal}: stopping the server and removing the temporary copy...`);
    void cleanup().then(({ problems }) => {
      for (const problem of problems) say(`Could not stop ${problem}`);
      process.exit(signalExitCode(signal));
    });
  });
}

/** Builds the copy with no sign-in settings, as a build is made before deployment. */
async function build(copy: string): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...serverEnv(process.env, {}), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
  const launched = launch("build", copy, [NEXT, "build"], env);
  const code = await launched.done;
  if (interrupted !== null || code === 0) return;
  const output = launched.output();
  const hint = /certificate|self.signed|SSL/i.test(output)
    ? "\nIf this is a certificate error while fetching Google Fonts, run it again with NODE_OPTIONS=--use-system-ca."
    : "";
  throw new SetupFailure(`The build of the copy failed. The last lines:\n${lastLines(output, 40)}${hint}`);
}

/** Starts the built copy on `port` and waits until /api/health answers. */
async function start(copy: string, port: number, env: NodeJS.ProcessEnv): Promise<Launched> {
  // The port was free a moment ago. If something answers on it now (a server a run left behind), its answer would be taken for ours.
  if ((await statusOf(port, "/api/health")) !== 0) {
    throw new SetupFailure(`Something already answers on port ${port}, so this run could not tell its own server from it. Run it again.`);
  }
  const server = launch("server", copy, [NEXT, "start", "-p", String(port), "-H", "127.0.0.1"], env);
  for (let waited = 0; waited < 30_000 && interrupted === null; waited += 250) {
    if (server.hasExited()) throw new SetupFailure(`The server stopped before it answered. The last lines:\n${lastLines(server.output(), 40)}`);
    if ((await statusOf(port, "/api/health")) === 200) return server;
    await pause(250);
  }
  if (interrupted === null) throw new SetupFailure(`The server did not answer /api/health within 30 seconds. The last lines:\n${lastLines(server.output(), 40)}`);
  return server;
}

/** Tells the page's own listener where to report a Content-Security-Policy violation (exposed to the page as __rbCsp). */
const CSP_LISTENER = `document.addEventListener("securitypolicyviolation", (event) => {
  try { window.__rbCsp(event.violatedDirective, event.blockedURI); } catch (error) {}
});`;

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.ok) throw new SetupFailure(options.message);
  const selected = selectChecks(CHECKS, options.only);
  if (!selected.ok) throw new SetupFailure(selected.message);

  const found = findPlaywright({ explicit: process.env.E2E_PLAYWRIGHT, globalRoot: process.env.E2E_PLAYWRIGHT?.trim() ? null : globalRoot(), exists: fs.existsSync });
  if ("message" in found) throw new SetupFailure(found.message);
  const { chromium } = createRequire(path.join(ROOT, "package.json"))(found.dir) as { chromium: PwChromium };

  say("Making a temporary copy of the app with an in-memory Sheet...");
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "rentbook-e2e-"));
  // Known to the cleanup from the first moment, so a run stopped while the copy is made leaves no half a copy behind.
  session.folder = copy;
  session.keepFolder = options.keep;
  let server: Launched | null = null;
  let copied = false;
  try {
    await fillCopy(copy);
    copied = true;
    if (interrupted !== null) return signalExitCode(interrupted);
    say("Building it (about half a minute)...");
    await build(copy);
    if (interrupted !== null) return signalExitCode(interrupted);

    const port = await freePort();
    const base = `http://localhost:${port}`;
    const { env, canaries } = dummyEnv(randomBytes);
    const control = path.join(copy, "e2e-control.json");
    fs.writeFileSync(control, JSON.stringify({ fail: {} }));
    say(`Starting it on port ${port}...`);
    server = await start(copy, port, { ...serverEnv(process.env, env), E2E_CONTROL: control, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PORT: String(port) });
    if (interrupted !== null) return signalExitCode(interrupted);

    const shots = options.shots === null ? null : path.resolve(options.shots);
    if (shots !== null) fs.mkdirSync(shots, { recursive: true });
    const failureShots = shots ?? path.join(copy, "screenshots");
    fs.mkdirSync(failureShots, { recursive: true });

    // Playwright would otherwise close the browser on Ctrl-C and then end the process itself, before the cleanup below has stopped the
    // server and deleted the copy: the run handles those signals itself.
    const browser = (session.browser = await chromium.launch({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }));
    const started = Date.now();
    const problems: string[] = [];
    let expectsHttpError = false;
    let lastActor: Actor | null = null;
    const actors = new Map<string, Actor>();
    const day = new Date();

    const run: Run = {
      base,
      now: day,
      canaries,
      shots,
      async actor(who: Who, scheme: Scheme = "light") {
        const key = `${who}-${scheme}`;
        let actor = actors.get(key);
        if (!actor) {
          const context = await browser.newContext({ viewport: { width: Number(process.env.E2E_WIDTH ?? PHONE.width) || PHONE.width, height: PHONE.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme });
          context.setDefaultTimeout(8000);
          context.setDefaultNavigationTimeout(20_000);
          const label = `${who} ${scheme}`;
          await context.exposeFunction("__rbCsp", (directive: string, blocked: string) => {
            problems.push(`${label}: the page's policy blocked ${blocked || "something"} (${directive})`);
          });
          await context.addInitScript(CSP_LISTENER);
          await context.route("**/*", async (route) => {
            const url = route.request().url();
            if (isLocalRequest(url, port)) return route.continue();
            // Only the host and path are kept: nothing here needs a query.
            problems.push(`${label}: tried to reach ${url.split("?")[0]}, which is not the local server`);
            return route.abort();
          });
          if (who !== "nobody") {
            const cookie = await sessionCookie(`${who}@example.com`, env.AUTH_SECRET, Date.now());
            await context.addCookies([{ ...cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
          }
          const page = await context.newPage();
          page.on("console", (message) => {
            if (consoleProblem({ type: message.type(), text: message.text() }, expectsHttpError)) problems.push(`${label}: console error: ${message.text()}`);
          });
          page.on("pageerror", (error) => problems.push(`${label}: page error: ${error.message}`));
          actor = { who, scheme, page, context };
          actors.set(key, actor);
        }
        lastActor = actor;
        return actor;
      },
      fail: (faults) => fs.writeFileSync(control, JSON.stringify({ fail: faults })),
      heal: () => fs.writeFileSync(control, JSON.stringify({ fail: {} })),
      expectsHttpError: () => {
        expectsHttpError = true;
      },
      problem: (text) => {
        problems.push(text);
      },
    };

    const results: CheckResult[] = [];
    for (const name of selected.names) {
      if (interrupted !== null) return signalExitCode(interrupted);
      const check = CHECKS.find((candidate) => candidate.name === name)!;
      problems.length = 0;
      expectsHttpError = false;
      lastActor = null;
      run.heal();
      const began = Date.now();
      let reason: string | null = null;
      try {
        await check.run(run);
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
      // A check that stopped because the run was stopped is not a failure to report.
      if (interrupted !== null) return signalExitCode(interrupted);
      // What the browser noticed while the check ran fails it, with the check's own reason first.
      if (problems.length > 0) reason = [reason, ...problems.slice(0, 6), problems.length > 6 ? `and ${problems.length - 6} more` : null].filter(Boolean).join("; ");
      const result: CheckResult = { name, ok: reason === null, seconds: (Date.now() - began) / 1000 };
      if (reason !== null) {
        result.reason = reason;
        const shown = lastActor as Actor | null;
        if (shown) {
          const file = path.join(failureShots, `FAIL-${name}.png`);
          try {
            await shown.page.screenshot({ path: file, fullPage: true });
            result.screenshot = file;
          } catch {
            // The page may be gone or mid-navigation; the reason stands without a picture.
          }
        }
      }
      say(report([result]).text.split("\n")[0]);
      // The line above is short; each thing the check found wrong is listed here in full.
      for (const problem of problems.slice(0, 40)) say(`      ${problem}`);
      results.push(result);
    }

    // The last check: the server's own output holds no secret.
    const leaks = leaked(server.output(), canaries);
    const outputResult: CheckResult = { name: "server-output", ok: leaks.length === 0, seconds: 0, reason: `the server wrote the ${leaks.join(", ")} value to its output` };
    say(report([outputResult]).text.split("\n")[0]);
    results.push(outputResult);

    const { text, exitCode } = report(results);
    say(`\n${text}\nWall time ${((Date.now() - started) / 1000).toFixed(0)} s.`);
    // A run in which something failed keeps its copy, with the screenshots, to look at.
    if (exitCode !== 0) session.keepFolder = true;
    return exitCode;
  } catch (error) {
    // A run that could not start keeps its copy too, to look at; one that was stopped, or whose copy could not be made, does not.
    if (interrupted === null && copied) session.keepFolder = true;
    throw error;
  } finally {
    const { problems } = await cleanup();
    for (const problem of problems) say(`Could not stop ${problem}`);
    if (session.keepFolder) say(`The temporary copy is kept: ${copy}`);
  }
}

/** However the run ended, the exit code says how: the signal's, when a signal stopped it. */
const leave = (code: number) => process.exit(interrupted !== null ? signalExitCode(interrupted) : code);

main().then(leave, (error: unknown) => {
  if (error instanceof SetupFailure) {
    process.stderr.write(`${error.message}\n`);
  } else if (interrupted === null) {
    process.stderr.write(`The run stopped: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  }
  leave(2);
});
