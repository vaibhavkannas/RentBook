import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * The server writes to its log only through logEvent (src/lib/server/log.ts), which builds one JSON line from a fixed
 * list of fields. A plain console call can print a whole error object, which can carry the request Google was sent.
 * eslint.config.mjs forbids the console in src, except in log.ts. These tests lint snippets with that very
 * configuration, so the ways round it that a text search would miss stay caught; `npm run lint` applies it to src.
 * (The scripts in scripts/ and the tests are command-line and test code, so they are not covered.)
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "eslint.config.mjs") });

const RULES = ["no-restricted-globals", "no-restricted-properties", "no-restricted-imports"];

/** The console-related problems ESLint reports for `code` as if it lived in `file`. */
async function problems(code: string, file = "src/lib/server/example.ts") {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return result.messages.filter((message) => RULES.includes(message.ruleId ?? "")).map((message) => message.ruleId);
}

const BYPASSES: Array<[string, string]> = [
  ["a console call", 'console.error("x", error);'],
  ["console.log", "console.log(error);"],
  ["console in brackets", 'console["warn"](error);'],
  ["a destructured method", "const { error } = console;\nerror(failure);"],
  ["the console passed on", "const log = (sink: Console) => sink;\nlog(console);"],
  ["a destructured console", 'const { console: c } = globalThis;\nc.error("x");'],
  ["globalThis.console", "globalThis.console.error(error);"],
  ['globalThis["console"]', 'globalThis["console"].error(error);'],
  ["global.console", "global.console.warn(error);"],
  ["process.stderr.write", 'process.stderr.write("x\\n");'],
  ["process.stdout.write", 'process.stdout.write("x\\n");'],
  ["a destructured stream", "const { stderr } = process;\nstderr.write(text);"],
  ["a comment mark inside a string before the call", 'const url = "https://example.com//x /* y";\nconsole.error(url);'],
  ["an import of the console module", 'import { Console } from "node:console";\nnew Console(process.stdout);'],
];

describe("the console rule", () => {
  it.each(BYPASSES)("refuses %s in src", async (_name, code) => {
    expect((await problems(code)).length).toBeGreaterThan(0);
  });

  it("refuses it in a component and in a route too", async () => {
    expect((await problems("console.error(1);", "src/components/Example.tsx")).length).toBeGreaterThan(0);
    expect((await problems("console.error(1);", "src/app/api/example/route.ts")).length).toBeGreaterThan(0);
    expect((await problems("console.error(1);", "src/instrumentation.ts")).length).toBeGreaterThan(0);
  });

  it("allows the logger itself to write to the console", async () => {
    expect(await problems("console[level](line);", "src/lib/server/log.ts")).toEqual([]);
  });

  it("does not flag a comment or a string that only talks about the console", async () => {
    const code = '// console.error(error) is not allowed here\nconst note = "console.error(error)";\nexport { note };';
    expect(await problems(code)).toEqual([]);
  });

  it("does not apply to the scripts and the tests", async () => {
    expect(await problems("console.log(1);", "scripts/example.ts")).toEqual([]);
    expect(await problems("console.log(1);", "tests/server/example.test.ts")).toEqual([]);
  });
});
