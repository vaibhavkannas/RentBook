import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "next-auth/jwt";
import { afterEach, describe, expect, it } from "vitest";
import { assertAuthConfig, readEnv } from "@/lib/server/env";
import { isSessionCurrent } from "@/lib/server/session-policy";
import { envChecks } from "@/lib/server/setup-env";
import {
  APP_VARIABLES,
  COPY_LIST,
  consoleProblem,
  dummyEnv,
  findPlaywright,
  INSTALL_HINT,
  isLocalRequest,
  KNOWN_PLAYWRIGHT,
  lastLines,
  leaked,
  linkTree,
  parseArgs,
  scriptsWithoutNonce,
  report,
  selectChecks,
  serverEnv,
  SESSION_COOKIE,
  sessionCookie,
  type CheckResult,
} from "../../scripts/e2e/helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** A random source that is the same every time: byte `n` of every call is `n + seed`. */
const counting = (seed = 0) => (bytes: number) => Buffer.from(Array.from({ length: bytes }, (_, n) => (n + seed) % 256));

describe("findPlaywright", () => {
  const present = (...dirs: string[]) => (file: string) => dirs.some((dir) => file === path.join(dir, "package.json"));

  it("takes the folder E2E_PLAYWRIGHT names, before any other", () => {
    expect(findPlaywright({ explicit: "/mine/playwright", globalRoot: "/g", exists: present("/mine/playwright", "/g/playwright") })).toEqual({
      dir: "/mine/playwright",
    });
  });

  it("stops when E2E_PLAYWRIGHT is set but there is no Playwright there, and does not look elsewhere", () => {
    const found = findPlaywright({ explicit: "/nonexistent", globalRoot: "/g", exists: present("/g/playwright", KNOWN_PLAYWRIGHT) });
    expect(found).toHaveProperty("message");
    const { message } = found as { message: string };
    expect(message).toContain("/nonexistent");
    expect(message).toContain(INSTALL_HINT);
  });

  it("ignores a blank E2E_PLAYWRIGHT", () => {
    expect(findPlaywright({ explicit: "  ", globalRoot: "/g", exists: present("/g/playwright") })).toEqual({ dir: path.join("/g", "playwright") });
    expect(findPlaywright({ explicit: undefined, globalRoot: "/g", exists: present("/g/playwright") })).toEqual({ dir: path.join("/g", "playwright") });
  });

  it("then looks in the global npm folder, then in the known tools folder", () => {
    expect(findPlaywright({ explicit: undefined, globalRoot: "/g", exists: present("/g/playwright", KNOWN_PLAYWRIGHT) })).toEqual({
      dir: path.join("/g", "playwright"),
    });
    expect(findPlaywright({ explicit: undefined, globalRoot: "/g", exists: present(KNOWN_PLAYWRIGHT) })).toEqual({ dir: KNOWN_PLAYWRIGHT });
    expect(findPlaywright({ explicit: undefined, globalRoot: null, exists: present(KNOWN_PLAYWRIGHT) })).toEqual({ dir: KNOWN_PLAYWRIGHT });
  });

  it("says how to install it when it is nowhere", () => {
    expect(findPlaywright({ explicit: undefined, globalRoot: "/g", exists: () => false })).toEqual({ message: INSTALL_HINT });
    expect(findPlaywright({ explicit: undefined, globalRoot: null, exists: () => false })).toEqual({ message: INSTALL_HINT });
  });

  it("words the hint as the brief does: outside the project, and the way to point at it", () => {
    expect(INSTALL_HINT).toBe(
      "Playwright isn't installed. Install it outside this project with `npm install -g playwright`, then `npx playwright install chromium`, or set E2E_PLAYWRIGHT to the folder of the playwright package.",
    );
  });
});

describe("dummyEnv", () => {
  const { env, canaries } = dummyEnv(counting());

  it("makes a 64-character AUTH_SECRET from the random source, and a different one from a different source", () => {
    expect(env.AUTH_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(dummyEnv(counting(7)).env.AUTH_SECRET).not.toBe(env.AUTH_SECRET);
    expect(dummyEnv(counting()).env.AUTH_SECRET).toBe(env.AUTH_SECRET);
  });

  it("names the two people the run signs in, the Sheet and the total header", () => {
    expect(env.ALLOWED_EMAILS).toBe("owner@example.com, member@example.com");
    expect(env.SHEET_ID).toBe("e2e-not-a-real-sheet");
    expect(env.TOTAL_HEADER).toBe("Total Rent");
    expect(env.AUTH_TRUST_HOST).toBe("true");
    expect(env.AUTH_GOOGLE_ID).toBeTruthy();
    expect(env.AUTH_GOOGLE_SECRET).toBeTruthy();
  });

  it("gives a service account of example.com with a private key that is not one", () => {
    const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    expect(account.client_email).toBe("e2e-sheets@example.com");
    expect(account.private_key).toMatch(/^-----BEGIN PRIVATE KEY-----\n[0-9a-f]+\n-----END PRIVATE KEY-----\n$/);
  });

  it("holds no address that is not at example.com, and no real-looking Google address", () => {
    const text = Object.values(env).join(" ");
    const addresses = text.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(address.endsWith("@example.com"), address).toBe(true);
  });

  it("lists a canary for each secret and for the Sheet's id, each one in the environment, none of them short", () => {
    expect(Object.keys(canaries).sort()).toEqual(["AUTH_GOOGLE_SECRET", "AUTH_SECRET", "PRIVATE_KEY", "SHEET_ID"]);
    const all = JSON.stringify(env);
    for (const [name, value] of Object.entries(canaries)) {
      expect(value.length, name).toBeGreaterThanOrEqual(16);
      expect(all, name).toContain(value);
    }
    expect(canaries.AUTH_SECRET).toBe(env.AUTH_SECRET);
  });

  it("is a set of settings the app itself accepts: it reads, passes the sign-in check, and every setting reads OK in Set up", () => {
    expect(() => readEnv(env)).not.toThrow();
    expect(() => assertAuthConfig(env)).not.toThrow();
    expect(envChecks(env).filter((check) => check.status !== "ok")).toEqual([]);
  });
});

describe("serverEnv", () => {
  it("drops every setting of the app that the machine already has, so a variable of the owner's cannot change the run", () => {
    const base = {
      PATH: "/bin",
      HOME: "/home/x",
      AUTH_URL: "https://real.example.org",
      SESSION_NOT_BEFORE: "2026-01-01T00:00:00Z",
      CSP_REPORT_ONLY: "1",
      SHEET_ID: "real",
      SCHEDULE_TAB: "Other",
      ALLOWED_EMAIL: "someone@example.com",
      E2E_CONTROL: "/old",
    };
    const { env } = dummyEnv(counting());
    const merged = serverEnv(base, env);
    expect(merged.PATH).toBe("/bin");
    expect(merged.HOME).toBe("/home/x");
    expect(merged.AUTH_URL).toBeUndefined();
    expect(merged.SESSION_NOT_BEFORE).toBeUndefined();
    expect(merged.CSP_REPORT_ONLY).toBeUndefined();
    expect(merged.SCHEDULE_TAB).toBeUndefined();
    expect(merged.ALLOWED_EMAIL).toBeUndefined();
    expect(merged.E2E_CONTROL).toBeUndefined();
    expect(merged.SHEET_ID).toBe("e2e-not-a-real-sheet");
  });

  it("names every setting the app reads, so none is forgotten", () => {
    for (const name of ["AUTH_SECRET", "AUTH_URL", "ALLOWED_EMAILS", "GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID", "SCHEDULE_TAB", "TOTAL_HEADER", "SESSION_NOT_BEFORE", "CSP_REPORT_ONLY"]) {
      expect(APP_VARIABLES).toContain(name);
    }
  });
});

describe("sessionCookie", () => {
  const NOW = Date.parse("2026-11-07T10:00:00Z");
  const SECRET = "x".repeat(64);

  it("is the cookie Auth.js reads on http, with the address, a sign-in time and nothing secret in the clear", async () => {
    const cookie = await sessionCookie("owner@example.com", SECRET, NOW);
    expect(cookie.name).toBe("authjs.session-token");
    expect(SESSION_COOKIE).toBe("authjs.session-token");
    expect(cookie.value).not.toContain("owner@example.com");
    const token = await decode({ token: cookie.value, secret: SECRET, salt: SESSION_COOKIE });
    expect(token).toMatchObject({ email: "owner@example.com", sub: "owner@example.com", issuedAt: NOW });
    expect(token?.name).toBeTruthy();
  });

  it("cannot be read with another secret", async () => {
    const cookie = await sessionCookie("member@example.com", SECRET, NOW);
    await expect(decode({ token: cookie.value, secret: "y".repeat(64), salt: SESSION_COOKIE })).rejects.toThrow();
  });

  it("is a sign-in the app counts as current", async () => {
    const cookie = await sessionCookie("member@example.com", SECRET, NOW);
    const token = await decode({ token: cookie.value, secret: SECRET, salt: SESSION_COOKIE });
    expect(isSessionCurrent(token?.issuedAt, undefined, NOW + 60_000)).toBe(true);
  });
});

describe("COPY_LIST", () => {
  it("is the files a build of the app needs, and the in-memory Sheet, as the plan says", () => {
    expect([...COPY_LIST]).toEqual([
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "next.config.ts",
      "postcss.config.mjs",
      "src",
      "public",
      "tests/support",
      "scripts/e2e/sheet.ts",
    ]);
  });

  it("names only what exists", () => {
    for (const entry of COPY_LIST) expect(fs.existsSync(path.join(ROOT, entry)), entry).toBe(true);
  });

  it("brings no setting file, no build and no Playwright code into the copy", () => {
    for (const entry of COPY_LIST) {
      expect(entry).not.toMatch(/\.env|node_modules|\.next|helpers|run\.ts|checks/);
    }
  });
});

describe("linkTree", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const temp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rentbook-linktree-"));
    made.push(dir);
    return dir;
  };
  const source = () => {
    const from = temp();
    fs.mkdirSync(path.join(from, "a", "b"), { recursive: true });
    fs.mkdirSync(path.join(from, "empty"));
    fs.writeFileSync(path.join(from, "top.txt"), "top");
    fs.writeFileSync(path.join(from, "a", "mid.txt"), "mid");
    fs.writeFileSync(path.join(from, "a", "b", "deep.txt"), "deep");
    return from;
  };

  it("makes hard links of the files in the same folder structure, empty folders included", () => {
    const from = source();
    const to = path.join(temp(), "copy");
    linkTree(from, to);
    expect(fs.readFileSync(path.join(to, "a", "b", "deep.txt"), "utf8")).toBe("deep");
    expect(fs.readFileSync(path.join(to, "top.txt"), "utf8")).toBe("top");
    expect(fs.statSync(path.join(to, "empty")).isDirectory()).toBe(true);
    // a hard link is the same file: same inode, and no second copy of the bytes
    expect(fs.statSync(path.join(to, "a", "mid.txt")).ino).toBe(fs.statSync(path.join(from, "a", "mid.txt")).ino);
  });

  it("copies the file where a link is refused across drives (EXDEV) or by the file system (EPERM)", () => {
    for (const code of ["EXDEV", "EPERM"]) {
      const from = source();
      const to = path.join(temp(), "copy");
      const tried: string[] = [];
      linkTree(from, to, (existing, created) => {
        tried.push(String(created));
        throw Object.assign(new Error("no link"), { code });
      });
      expect(tried).toHaveLength(3);
      expect(fs.readFileSync(path.join(to, "a", "b", "deep.txt"), "utf8")).toBe("deep");
      expect(fs.statSync(path.join(to, "a", "mid.txt")).ino).not.toBe(fs.statSync(path.join(from, "a", "mid.txt")).ino);
    }
  });

  it("does not hide any other failure", () => {
    const from = source();
    const to = path.join(temp(), "copy");
    expect(() =>
      linkTree(from, to, () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }),
    ).toThrow("denied");
  });

  it("recreates a link to a file inside the tree as a link, so node_modules/.bin still points where it did", () => {
    const from = source();
    fs.mkdirSync(path.join(from, ".bin"));
    fs.symlinkSync("../a/mid.txt", path.join(from, ".bin", "mid"));
    const to = path.join(temp(), "copy");
    linkTree(from, to);
    expect(fs.readlinkSync(path.join(to, ".bin", "mid"))).toBe("../a/mid.txt");
    expect(fs.readFileSync(path.join(to, ".bin", "mid"), "utf8")).toBe("mid");
  });

  it("links a single file as well as a folder", () => {
    const from = source();
    const to = path.join(temp(), "x", "single.txt");
    linkTree(path.join(from, "top.txt"), to);
    expect(fs.readFileSync(to, "utf8")).toBe("top");
  });
});

describe("report", () => {
  const pass = (name: string, seconds: number): CheckResult => ({ name, ok: true, seconds });
  const fail = (name: string, reason: string, screenshot?: string): CheckResult => ({ name, ok: false, seconds: 0.4, reason, screenshot });

  it("lists a pass with its time and ends with the counts, and exits 0", () => {
    const { text, exitCode } = report([pass("sweep", 12.34), pass("undo", 1.2)]);
    expect(text.split("\n")).toEqual(["PASS  sweep (12.3 s)", "PASS  undo (1.2 s)", "2 passed, 0 failed."]);
    expect(exitCode).toBe(0);
  });

  it("lists a failure with its reason and the screenshot, and exits 1", () => {
    const { text, exitCode } = report([pass("sweep", 1), fail("undo", "No Undo button on the card", "/tmp/x/undo.png")]);
    expect(text.split("\n")).toEqual([
      "PASS  sweep (1.0 s)",
      "FAIL  undo: No Undo button on the card. Screenshot: /tmp/x/undo.png",
      "1 passed, 1 failed.",
    ]);
    expect(exitCode).toBe(1);
  });

  it("does not double the full stop, and says nothing of a screenshot that was not taken", () => {
    const lines = report([fail("a", "It broke."), fail("b", "It broke too", undefined)]).text.split("\n");
    expect(lines[0]).toBe("FAIL  a: It broke.");
    expect(lines[1]).toBe("FAIL  b: It broke too.");
  });

  it("keeps a long, many-lined reason (a Playwright error) to one short line", () => {
    const reason = `Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button')\n${"x".repeat(1000)}`;
    const [line] = report([fail("a", reason)]).text.split("\n");
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(400);
    expect(line.startsWith("FAIL  a: Timeout 5000ms exceeded.")).toBe(true);
  });

  it("counts a run in which nothing ran as a failure", () => {
    expect(report([])).toEqual({ text: "0 passed, 0 failed.", exitCode: 1 });
  });
});

describe("parseArgs", () => {
  it("has no options by default", () => {
    expect(parseArgs([])).toEqual({ ok: true, keep: false, only: null, shots: null });
  });

  it("reads --keep, --only with a list and --shots with a folder", () => {
    expect(parseArgs(["--keep", "--only", "sweep,undo", "--shots", "/tmp/shots"])).toEqual({
      ok: true,
      keep: true,
      only: ["sweep", "undo"],
      shots: "/tmp/shots",
    });
    expect(parseArgs(["--only", "a"])).toMatchObject({ only: ["a"] });
  });

  it("refuses an option it does not know, and an option with no value, with a sentence", () => {
    expect(parseArgs(["--fast"])).toEqual({ ok: false, message: 'Unknown option "--fast". Use --keep, --only a,b or --shots <folder>.' });
    expect(parseArgs(["--only"])).toMatchObject({ ok: false, message: expect.stringContaining("--only") });
    expect(parseArgs(["--shots"])).toMatchObject({ ok: false, message: expect.stringContaining("--shots") });
    expect(parseArgs(["--only", "--keep"])).toMatchObject({ ok: false });
  });
});

describe("selectChecks", () => {
  const all = [{ name: "first" }, { name: "log" }, { name: "undo", needs: ["log"] }, { name: "replace", needs: ["undo"] }, { name: "other" }];

  it("runs everything, in order, with no --only", () => {
    expect(selectChecks(all, null)).toEqual({ ok: true, names: ["first", "log", "undo", "replace", "other"] });
  });

  it("runs only the named checks, in the order of the run", () => {
    expect(selectChecks(all, ["other", "first"])).toEqual({ ok: true, names: ["first", "other"] });
  });

  it("adds what a check needs first, all the way back, so it starts from the data it expects", () => {
    expect(selectChecks(all, ["undo"])).toEqual({ ok: true, names: ["log", "undo"] });
    expect(selectChecks(all, ["replace"])).toEqual({ ok: true, names: ["log", "undo", "replace"] });
  });

  it("refuses a name that is not a check, and lists the ones that are", () => {
    expect(selectChecks(all, ["nope"])).toEqual({
      ok: false,
      message: 'There is no check called "nope". The checks are: first, log, undo, replace, other.',
    });
  });
});

describe("isLocalRequest", () => {
  it("is true for the local server's own address, however it is spelled, and for pages that make no request", () => {
    for (const url of ["http://localhost:4100/", "http://localhost:4100/_next/static/a.js", "http://127.0.0.1:4100/api/health", "data:image/png;base64,AAAA", "blob:http://localhost:4100/x", "about:blank"]) {
      expect(isLocalRequest(url, 4100), url).toBe(true);
    }
  });

  it("is false for any other host, another port, or an address that cannot be read", () => {
    for (const url of ["https://fonts.googleapis.com/css", "https://sheets.googleapis.com/v4", "http://localhost:4101/", "http://localhost.evil.example.com:4100/", "http://example.com:4100/", "not a url", "ws://example.com/"]) {
      expect(isLocalRequest(url, 4100), url).toBe(false);
    }
  });
});

describe("lastLines", () => {
  it("keeps the last n lines, and all of a shorter text", () => {
    expect(lastLines("a\nb\nc\nd", 2)).toBe("c\nd");
    expect(lastLines("a\nb", 5)).toBe("a\nb");
    expect(lastLines("a\nb\n\n", 2)).toBe("a\nb");
  });
});

describe("leaked", () => {
  const canaries = { AUTH_SECRET: "secret-value-0123456789", SHEET_ID: "sheet-id-0123456789" };

  it("names the canaries a text holds, never the text", () => {
    expect(leaked("a page with sheet-id-0123456789 in it", canaries)).toEqual(["SHEET_ID"]);
    expect(leaked("secret-value-0123456789 and sheet-id-0123456789", canaries)).toEqual(["AUTH_SECRET", "SHEET_ID"]);
    expect(leaked("a clean page", canaries)).toEqual([]);
  });
});

describe("scriptsWithoutNonce", () => {
  it("counts the script tags of a page that carry no nonce, which the page's policy would not let run", () => {
    const html = '<html><head><script src="/a.js" nonce="abc" async=""></script><script nonce="abc">x()</script></head></html>';
    expect(scriptsWithoutNonce(html)).toBe(0);
    expect(scriptsWithoutNonce(`${html}<script>y()</script><script src="/b.js"></script>`)).toBe(2);
  });

  it("does not take a nonce that is only in the text for one, and reads upper-case tags and tags over several lines", () => {
    expect(scriptsWithoutNonce('<p>a script with nonce="x"</p><script>y()</script>')).toBe(1);
    expect(scriptsWithoutNonce('<SCRIPT\n  src="/c.js"\n  nonce="n"></SCRIPT>')).toBe(0);
    expect(scriptsWithoutNonce("<scripts-list></scripts-list>")).toBe(0);
    expect(scriptsWithoutNonce("")).toBe(0);
  });
});

describe("consoleProblem", () => {
  it("counts an error, but not a log, a warning or an info line", () => {
    expect(consoleProblem({ type: "error", text: "Uncaught TypeError" }, false)).toBe(true);
    for (const type of ["log", "warning", "info", "debug"]) expect(consoleProblem({ type: type, text: "x" }, false), type).toBe(false);
  });

  it("lets the browser's own 'Failed to load resource' line pass only where the check expects an HTTP error", () => {
    const line = { type: "error", text: "Failed to load resource: the server responded with a status of 404 ()" };
    expect(consoleProblem(line, false)).toBe(true);
    expect(consoleProblem(line, true)).toBe(false);
    expect(consoleProblem({ type: "error", text: "Uncaught TypeError" }, true)).toBe(true);
  });
});

describe("the helpers and the runner use no Playwright module of their own", () => {
  it("import none: Playwright is found at run time, outside the project", () => {
    for (const file of ["helpers.ts", "run.ts", "checks.ts"]) {
      const source = fs.readFileSync(path.join(ROOT, "scripts", "e2e", file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'](?:@playwright\/test|playwright(?:-core)?)(?:\/[^"']*)?["']/);
      expect(source, file).not.toMatch(/require\(\s*["'](?:@playwright\/test|playwright(?:-core)?)["']\s*\)/);
    }
  });
});

describe("random source", () => {
  it("is the one the runner uses for a real run", () => {
    const { env } = dummyEnv((bytes) => randomBytes(bytes));
    expect(env.AUTH_SECRET).toHaveLength(64);
    expect(dummyEnv((bytes) => randomBytes(bytes)).env.AUTH_SECRET).not.toBe(env.AUTH_SECRET);
  });
});
