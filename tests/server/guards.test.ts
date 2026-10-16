import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every page and route handler under src/app must ask who is signed in, or be on the short list below of files that
 * are open on purpose. This reads the source files, so a new page or route that forgets the check fails here.
 *
 * It is a safety net, not a proof: it finds the call in the text of the file (comments and strings do not count),
 * it does not follow a check hidden inside a helper, and it does not run the code. The route tests in routes.test.ts
 * and the page tests show that the checks do what they should.
 */

const APP_DIR = fileURLToPath(new URL("../../src/app", import.meta.url));

/** Pages and routes that are open on purpose, as the folder they live in (the folder and everything below it). */
const OPEN_FOLDERS = [
  "signin", // the sign-in page: it must open for people who are not signed in (it sends signed-in people home)
  "api/auth", // Auth.js's own sign-in, sign-out and callback routes
  "api/health", // the health check, for uptime monitors (arrives with the error pages)
];

/** Special files Next serves without any page of ours, as their name without the extension. All are public. */
const OPEN_SPECIAL_FILES = ["robots", "manifest", "icon", "apple-icon", "not-found"];

/** The ways a person can be found out: `getViewer` returns null for a stranger, the other two refuse them. */
const GUARDS = ["getViewer", "requireUser", "requireOwner"];
const AUTH_GUARD_MODULE = "@/lib/server/auth-guard";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Files that answer a request on their own: pages, route handlers, and the special files Next serves. */
const ENTRY_FILE =
  /^(page|route|not-found|robots|manifest|sitemap|(?:apple-)?icon\d*|opengraph-image\d*|twitter-image\d*)\.[cm]?[jt]sx?$/;

/** A comment or a string, found in the order they appear, so a comment mark inside a string is not a comment. */
const COMMENT_OR_STRING =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;

const isComment = (token: string) => token.startsWith("//") || token.startsWith("/*");
const withoutComments = (source: string) => source.replace(COMMENT_OR_STRING, (t) => (isComment(t) ? " " : t));
const withoutCommentsAndStrings = (source: string) =>
  source.replace(COMMENT_OR_STRING, (t) => (isComment(t) ? " " : '""'));

/** How many times `name(` is called in `code`. A method call such as `x.name(` does not count. */
function callCount(code: string, name: string): number {
  return code.match(new RegExp(`(?<![.\\w$])${name}\\s*\\(`, "g"))?.length ?? 0;
}

/** The names a file imports from the auth guard module. */
function guardsImported(source: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${AUTH_GUARD_MODULE}["']`, "g");
  for (const match of withoutComments(source).matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const name = part.replace(/^\s*type\s+/, "").trim();
      if (GUARDS.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * The HTTP methods a route file exports: `export async function POST`, `export const PUT =`,
 * `export const { GET, POST } =` and `export { GET }`.
 */
function methodsExported(code: string): string[] {
  const found = new Set<string>();
  const method = HTTP_METHODS.join("|");
  const declared = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+(${method})\\b`, "g"),
    new RegExp(`export\\s+(?:const|let|var)\\s+(${method})\\b`, "g"),
  ];
  for (const pattern of declared) {
    for (const match of code.matchAll(pattern)) found.add(match[1]);
  }
  for (const match of code.matchAll(/export\s+(?:const\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part.split(/\s+as\s+/).pop()!.trim();
      if (HTTP_METHODS.includes(name)) found.add(name);
    }
  }
  return [...found];
}

/** What is wrong with the way this page or route file checks who is signed in, or null when it checks properly. */
function guardProblem(file: string, source: string): string | null {
  const imported = guardsImported(source);
  if (imported.length === 0) {
    return `${file} does not import getViewer, requireUser or requireOwner from ${AUTH_GUARD_MODULE}.`;
  }
  const code = withoutCommentsAndStrings(source);
  const calls = Object.fromEntries(imported.map((name) => [name, callCount(code, name)]));
  const guardCalls = Object.values(calls).reduce((sum, count) => sum + count, 0);
  if (guardCalls === 0) {
    return `${file} imports ${imported.join(", ")} but never calls it (a comment or a string does not count).`;
  }

  if (path.basename(file).startsWith("route.")) {
    const handlers = Math.max(methodsExported(code).length, 1);
    if (callCount(code, "handle") < handlers) {
      return `${file} must run each handler inside handle(), so a refused person gets a 401 or 403 answer.`;
    }
    if (guardCalls < handlers) {
      return `${file} exports ${handlers} handlers but checks who is signed in only ${guardCalls} time(s).`;
    }
    return null;
  }

  // A page. requireUser and requireOwner refuse a stranger themselves; getViewer only says who they are, so the
  // page has to send a stranger away after asking.
  const refuses = (calls.requireUser ?? 0) + (calls.requireOwner ?? 0) > 0;
  if (!refuses) {
    const firstCall = code.search(/(?<![.\w$])getViewer\s*\(/);
    if (!/(?<![.\w$])(redirect|notFound)\s*\(/.test(code.slice(firstCall))) {
      return `${file} asks getViewer() but never redirects a stranger away afterwards.`;
    }
  }
  return null;
}

type Entry = { file: string; folder: string; special: string | null };

/** Every page, route handler and special file under src/app, as a path relative to src/app. */
function appEntries(): Entry[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: "utf8" })
    .map((relative) => relative.split(path.sep).join("/"))
    .filter((relative) => ENTRY_FILE.test(path.posix.basename(relative)))
    .sort()
    .map((file) => {
      const folder = path.posix.dirname(file) === "." ? "" : path.posix.dirname(file);
      const stem = path.posix.basename(file).replace(/\.[^.]+$/, "");
      const special = stem === "page" || stem === "route" ? null : path.posix.join(folder, stem.replace(/\d+$/, ""));
      return { file, folder, special };
    });
}

function isOpenOnPurpose(entry: Entry): boolean {
  if (entry.special !== null) return OPEN_SPECIAL_FILES.includes(entry.special);
  return OPEN_FOLDERS.some((open) => entry.folder === open || entry.folder.startsWith(`${open}/`));
}

describe("the pages and routes under src/app", () => {
  const entries = appEntries();

  it("are found by reading the folder", () => {
    const files = entries.map((entry) => entry.file);
    expect(files).toEqual(
      expect.arrayContaining([
        "page.tsx",
        "activity/page.tsx",
        "settings/page.tsx",
        "tenants/[portionId]/page.tsx",
        "signin/page.tsx",
        "api/auth/[...nextauth]/route.ts",
        "api/payments/route.ts",
        "api/payments/log-retry/route.ts",
        "api/payments/undo/route.ts",
        "api/settings/route.ts",
        "api/tenancies/route.ts",
        "api/tenancies/move-out/route.ts",
        "robots.ts",
        "manifest.ts",
        "icon.tsx",
        "apple-icon.tsx",
        "not-found.tsx",
      ]),
    );
  });

  it("each ask who is signed in, unless the file is open on purpose", () => {
    const problems = entries
      .filter((entry) => !isOpenOnPurpose(entry))
      .map((entry) => guardProblem(entry.file, readFileSync(path.join(APP_DIR, entry.file), "utf8")))
      .filter((problem): problem is string => problem !== null);
    expect(problems).toEqual([]);
  });

  it("are not let through by a name that only looks like an open one", () => {
    const open = (file: string, folder: string, special: string | null) => isOpenOnPurpose({ file, folder, special });
    expect(open("robots/page.tsx", "robots", null)).toBe(false);
    expect(open("api/authorize/route.ts", "api/authorize", null)).toBe(false);
    expect(open("api/auth-x/route.ts", "api/auth-x", null)).toBe(false);
    expect(open("api/auth/extra/route.ts", "api/auth/extra", null)).toBe(true);
    expect(open("admin/icon.tsx", "admin", "admin/icon")).toBe(false);
    expect(open("sitemap.ts", "", "sitemap")).toBe(false);
  });
});

describe("the check for one file", () => {
  const IMPORTS = 'import { requireUser } from "@/lib/server/auth-guard";\nimport { handle } from "@/lib/server/http";';
  const route = (body: string, imports = IMPORTS) => `${imports}\n${body}`;

  it("accepts a route that checks the person inside handle()", () => {
    const source = route(`export async function POST() {
      return handle(async () => {
        const viewer = await requireUser();
        return { email: viewer.email };
      });
    }`);
    expect(guardProblem("api/x/route.ts", source)).toBeNull();
  });

  it("accepts requireOwner and getViewer in a route too", () => {
    const owner = route(
      `export async function PUT() { return handle(async () => { await requireOwner(); return {}; }); }`,
      'import { requireOwner } from "@/lib/server/auth-guard";',
    );
    expect(guardProblem("api/x/route.ts", owner)).toBeNull();
    const viewer = route(
      `export async function GET() { return handle(async () => { const v = await getViewer(); return { v }; }); }`,
      'import { getViewer } from "@/lib/server/auth-guard";',
    );
    expect(guardProblem("api/x/route.ts", viewer)).toBeNull();
  });

  it("refuses a route that never asks", () => {
    const source = route(`export async function POST() { return handle(async () => ({})); }`, 'import { handle } from "@/lib/server/http";');
    expect(guardProblem("api/x/route.ts", source)).toMatch(/does not import getViewer, requireUser or requireOwner/);
  });

  it("refuses a route that imports the check and does not call it", () => {
    const source = route(`export async function POST() { return handle(async () => ({})); }`);
    expect(guardProblem("api/x/route.ts", source)).toMatch(/never calls it/);
  });

  it("does not count a call in a comment or in a string", () => {
    const comment = route(`export async function POST() {
      // const viewer = await requireUser();
      /* await requireUser(); */
      return handle(async () => ({}));
    }`);
    expect(guardProblem("api/x/route.ts", comment)).toMatch(/never calls it/);
    const text = route(`export async function POST() {
      const note = "await requireUser()";
      const other = \`requireUser(\`;
      return handle(async () => ({ note, other }));
    }`);
    expect(guardProblem("api/x/route.ts", text)).toMatch(/never calls it/);
  });

  it("does not count a function that only has the guard's name", () => {
    const source = `import { handle } from "@/lib/server/http";
      const requireUser = async () => ({});
      export async function POST() { return handle(async () => { await requireUser(); return {}; }); }`;
    expect(guardProblem("api/x/route.ts", source)).toMatch(/does not import/);
  });

  it("refuses a route that has a second handler without its own check", () => {
    const source = route(`export async function POST() { return handle(async () => { await requireUser(); return {}; }); }
      export async function DELETE() { return handle(async () => ({})); }`);
    expect(guardProblem("api/x/route.ts", source)).toMatch(/exports 2 handlers but checks who is signed in only 1 time/);
    const constStyle = route(`export async function POST() { return handle(async () => { await requireUser(); return {}; }); }
      export const GET = () => handle(async () => ({}));`);
    expect(guardProblem("api/x/route.ts", constStyle)).toMatch(/exports 2 handlers/);
  });

  it("refuses a route whose handler does not run inside handle()", () => {
    const source = route(`export async function POST() { await requireUser(); return Response.json({}); }`);
    expect(guardProblem("api/x/route.ts", source)).toMatch(/inside handle\(\)/);
  });

  it("accepts a page that asks getViewer and sends a stranger away", () => {
    const source = `import { redirect } from "next/navigation";
      import { getViewer } from "@/lib/server/auth-guard";
      export default async function Page() {
        const viewer = await getViewer();
        if (!viewer) redirect("/signin");
        return null;
      }`;
    expect(guardProblem("x/page.tsx", source)).toBeNull();
  });

  it("refuses a page that asks getViewer and then shows the page to anyone", () => {
    const source = `import { getViewer } from "@/lib/server/auth-guard";
      export default async function Page() {
        const viewer = await getViewer();
        return <p>{viewer?.email}</p>;
      }`;
    expect(guardProblem("x/page.tsx", source)).toMatch(/never redirects a stranger away/);
  });

  it("accepts a page that uses requireUser or requireOwner, which refuse a stranger themselves", () => {
    const source = `import { requireOwner } from "@/lib/server/auth-guard";
      export default async function Page() {
        await requireOwner();
        return null;
      }`;
    expect(guardProblem("x/page.tsx", source)).toBeNull();
  });

  it("refuses a page that never asks", () => {
    expect(guardProblem("x/page.tsx", "export default function Page() { return null; }")).toMatch(
      /does not import getViewer/,
    );
  });
});
