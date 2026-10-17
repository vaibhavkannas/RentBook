import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMENT_OR_STRING, withoutComments } from "../support/source-scan";

/**
 * No message a person can read tells them to "refresh" or "reload": the installed app has neither a pull to refresh nor
 * a refresh button, so every such message uses the one recovery phrase in src/lib/recovery-hint.ts (switch to another
 * tab and back). This reads every source file under src for strings and text that say it in a sentence.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** The sentences a source file holds: its strings and templates (what `${...}` computes left out) and its JSX text. */
export function sentencesIn(source: string): string[] {
  const code = withoutComments(source);
  const strings = [...code.matchAll(COMMENT_OR_STRING)].map((match) => match[0].slice(1, -1).replace(/\$\{[^}]*\}/g, ""));
  const jsx = [...code.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
  return [...strings, ...jsx].filter((text) => /\s/.test(text.trim()));
}

const SAYS_REFRESH = /\b(?:re-?fresh(?:ing)?|re-?load(?:ing)?)\b/i;

describe("sentencesIn", () => {
  it("finds strings, templates and JSX text, and leaves out comments, names and what a template computes", () => {
    const source = [
      '// Refresh the page',
      'const a = "Refresh the page.";',
      "const b = `Hello ${reloadThen(\"try again\")}, reload it`;",
      'const c = "refresh";',
      'const d = <p>Reload the page</p>;',
      'import x from "@/lib/back-refresh";',
    ].join("\n");
    expect(sentencesIn(source)).toEqual(["Refresh the page.", "Hello , reload it", "Reload the page"]);
  });
});

describe("the sentences in src", () => {
  it("read all the files", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("never tell a person to refresh or reload", () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      sentencesIn(readFileSync(file, "utf8"))
        .filter((sentence) => SAYS_REFRESH.test(sentence))
        .map((sentence) => `${path.relative(SRC, file)}: ${sentence}`),
    );
    expect(found).toEqual([]);
  });
});
