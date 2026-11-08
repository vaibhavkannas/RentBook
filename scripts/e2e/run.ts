/**
 * An on-demand end-to-end run of the real app, in a phone-sized Chromium, without touching Google.
 *
 *   npm run e2e [-- --keep] [--only sweep,undo] [--shots <folder>]
 *
 * It makes a temporary copy of the app, puts an in-memory Sheet in the copy (scripts/e2e/sheet.ts), builds the copy and starts it
 * with made-up settings, signs two people in with cookies it makes itself, and drives Chromium at 390 by 844 through every page
 * and the main journeys (checks.ts); the two people are signed in with cookies the run makes itself, so Google's sign-in is never
 * used. The browser refuses every request that is not to the local server, so a run never reaches the Google Sheets API or any
 * Google account, and the copy of the app talks only to the in-memory Sheet. (The build of the copy downloads the Geist font from
 * Google Fonts, with no credentials.) Playwright is not a dependency: it is installed outside this project (see findPlaywright
 * in helpers.ts). Not part of CI, which has no browser.
 *
 * Exit code: 0 all checks passed, 1 a check failed, 2 the run could not start (no Playwright, a failed build, a server that did not come up).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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
  lastLines,
  leaked,
  linkTree,
  parseArgs,
  PHONE,
  consoleProblem,
  report,
  selectChecks,
  serverEnv,
  sessionCookie,
  type CheckResult,
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

/** The temporary copy of the app, with the in-memory Sheet in it. */
function makeCopy(): string {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "rentbook-e2e-"));
  try {
    fillCopy(copy);
  } catch (error) {
    fs.rmSync(copy, { recursive: true, force: true });
    throw error;
  }
  return copy;
}

function fillCopy(copy: string): void {
  for (const entry of COPY_LIST) {
    // A real copy, not a link: the gateway module below is rewritten, which would change the project's own file through a hard link.
    // The tests of the support files are not needed to build.
    fs.cpSync(path.join(ROOT, entry), path.join(copy, entry), { recursive: true, filter: (from) => !from.endsWith(".test.ts") });
  }
  linkTree(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"));
  const gateway = path.join(copy, "src", "lib", "server", "gateway-source.ts");
  if (fs.statSync(gateway).ino === fs.statSync(path.join(ROOT, "src", "lib", "server", "gateway-source.ts")).ino) {
    throw new SetupFailure("The copy shares a file with the project, so the Sheet was not swapped. Nothing was changed.");
  }
  fs.writeFileSync(gateway, GATEWAY_LINE);
  if (fs.readFileSync(gateway, "utf8") !== GATEWAY_LINE) throw new SetupFailure("The in-memory Sheet did not go into the copy.");
}

/** Builds the copy with no sign-in settings, as a build is made before deployment. */
function build(copy: string): void {
  const result = spawnSync(process.execPath, [NEXT, "build"], {
    cwd: copy,
    env: { ...serverEnv(process.env, {}), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status === 0) return;
  const output = `${result.stdout}\n${result.stderr}`;
  const hint = /certificate|self.signed|SSL/i.test(output)
    ? "\nIf this is a certificate error while fetching Google Fonts, run it again with NODE_OPTIONS=--use-system-ca."
    : "";
  throw new SetupFailure(`The build of the copy failed. The last lines:\n${lastLines(output, 40)}${hint}`);
}

type Server = { process: ChildProcess; output: () => string; stop(): Promise<void> };

/** Starts the built copy on `port` and waits until /api/health answers. */
async function start(copy: string, port: number, env: NodeJS.ProcessEnv): Promise<Server> {
  const child = spawn(process.execPath, [NEXT, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: copy,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exited = false;
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 4_000_000) output = output.slice(-2_000_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.once("exit", () => {
    exited = true;
  });
  const stop = async () => {
    if (exited) return;
    child.kill("SIGTERM");
    for (let waited = 0; !exited && waited < 5000; waited += 100) await pause(100);
    if (!exited) child.kill("SIGKILL");
  };
  for (let waited = 0; waited < 30_000; waited += 250) {
    if (exited) throw new SetupFailure(`The server stopped before it answered. The last lines:\n${lastLines(output, 40)}`);
    if ((await statusOf(port, "/api/health")) === 200) return { process: child, output: () => output, stop };
    await pause(250);
  }
  await stop();
  throw new SetupFailure(`The server did not answer /api/health within 30 seconds. The last lines:\n${lastLines(output, 40)}`);
}

/** Tells the page's own listener where to report a Content-Security-Policy violation (exposed to the page as __rbCsp). */
const CSP_LISTENER = `document.addEventListener("securitypolicyviolation", (event) => {
  try { window.__rbCsp(event.violatedDirective, event.blockedURI); } catch (error) {}
});`;

/** The server that is running, so a Ctrl-C can stop it. */
let running: Server | null = null;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void (running?.stop() ?? Promise.resolve()).finally(() => process.exit(130));
  });
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.ok) throw new SetupFailure(options.message);
  const selected = selectChecks(CHECKS, options.only);
  if (!selected.ok) throw new SetupFailure(selected.message);

  const found = findPlaywright({ explicit: process.env.E2E_PLAYWRIGHT, globalRoot: process.env.E2E_PLAYWRIGHT?.trim() ? null : globalRoot(), exists: fs.existsSync });
  if ("message" in found) throw new SetupFailure(found.message);
  const { chromium } = createRequire(path.join(ROOT, "package.json"))(found.dir) as { chromium: PwChromium };

  say("Making a temporary copy of the app with an in-memory Sheet...");
  const copy = makeCopy();
  const keepFolder = options.keep;
  let server: Server | null = null;
  let browser: PwBrowser | null = null;
  let failed = true;
  try {
    say("Building it (about half a minute)...");
    build(copy);

    const port = await freePort();
    const base = `http://localhost:${port}`;
    const { env, canaries } = dummyEnv(randomBytes);
    const control = path.join(copy, "e2e-control.json");
    fs.writeFileSync(control, JSON.stringify({ fail: {} }));
    say(`Starting it on port ${port}...`);
    server = running = await start(copy, port, { ...serverEnv(process.env, env), E2E_CONTROL: control, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PORT: String(port) });

    const shots = options.shots === null ? null : path.resolve(options.shots);
    if (shots !== null) fs.mkdirSync(shots, { recursive: true });
    const failureShots = shots ?? path.join(copy, "screenshots");
    fs.mkdirSync(failureShots, { recursive: true });

    browser = await chromium.launch({ headless: true });
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
          const context = await browser!.newContext({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme });
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
    failed = exitCode !== 0;
    return exitCode;
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.stop();
    if (failed || keepFolder) say(`The temporary copy is kept: ${copy}`);
    else fs.rmSync(copy, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof SetupFailure) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`The run stopped: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    }
    process.exit(2);
  },
);
