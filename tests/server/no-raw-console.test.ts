import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The server writes to its log only through logEvent (src/lib/server/log.ts), which builds one JSON line from a
 * fixed list of fields. A plain console call in src can print a whole error object, which can carry the request
 * Google was sent, so none is allowed outside the logger. (The scripts in scripts/ are command-line tools whose
 * output is for the person running them, so they are not checked.)
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** The one file that writes to the console: logEvent itself. */
const LOGGER = "lib/server/log.ts";

const sourceFiles = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => name.split(path.sep).join("/"))
  .sort();

/** The source without its comments, so a comment may talk about console.error. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** `console.error(`, `console.warn`, `console["log"]` and so on: any use of the console object. */
const CONSOLE_USE = /\bconsole\s*(?:\.|\?\.|\[)/;

describe("server logging", () => {
  it("finds the source files, the logger and instrumentation among them", () => {
    expect(sourceFiles).toEqual(expect.arrayContaining([LOGGER, "instrumentation.ts", "lib/sheets/service.ts", "lib/server/problem.ts"]));
  });

  it("uses the console nowhere in src except in the logger", () => {
    const offenders = sourceFiles.filter(
      (file) => file !== LOGGER && CONSOLE_USE.test(withoutComments(readFileSync(path.join(SRC, file), "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("sees a console call, and ignores a comment that names one", () => {
    expect(CONSOLE_USE.test(withoutComments('console.error("x", error);'))).toBe(true);
    expect(CONSOLE_USE.test(withoutComments("console['warn'](error)"))).toBe(true);
    expect(CONSOLE_USE.test(withoutComments("// was console.error(error)\nconst a = 1;"))).toBe(false);
    expect(CONSOLE_USE.test(withoutComments("/** An info line goes to console.info. */\nconst a = 1;"))).toBe(false);
  });
});
