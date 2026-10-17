import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMENT_OR_STRING, withoutComments, withoutCommentsAndStrings } from "../support/source-scan";

/**
 * No message a person can read tells them to "refresh" or "reload": the installed app has neither a pull to refresh nor
 * a refresh button, so every such message uses the one recovery phrase in src/lib/recovery-hint.ts (tap another tab at
 * the bottom of the screen and come back). This reads every source file under src for strings and text that say it in a
 * sentence, and for two ways the phrase goes wrong: said in words of its own, and offered where nothing can be retried.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** A `{...}` expression, with one level of braces inside it (`{fn({ a: 1 })}`). */
const EXPRESSION = String.raw`\{(?:[^{}]|\{[^{}]*\})*\}`;

/** The text between two JSX tags where `{...}` expressions sit among the words: "Please refresh {name} now". */
const JSX_TEXT_WITH_EXPRESSIONS = new RegExp(String.raw`>((?:[^<>{}]|${EXPRESSION})*?${EXPRESSION}(?:[^<>{}]|${EXPRESSION})*)<`, "g");

/**
 * The sentences a source file holds: its strings and templates (what `${...}` computes left out) and its JSX text. JSX
 * text that an expression splits ("Please refresh {name} now", "Reload{" "}the page") is found with each expression
 * replaced by a space, so a word on either side of one is not missed.
 */
export function sentencesIn(source: string): string[] {
  const code = withoutComments(source);
  const strings = [...code.matchAll(COMMENT_OR_STRING)].map((match) => match[0].slice(1, -1).replace(/\$\{[^}]*\}/g, ""));
  const jsx = [...code.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
  // Strings are emptied first, so a brace or an angle bracket inside one cannot end a match early.
  const split = [...withoutCommentsAndStrings(source).matchAll(JSX_TEXT_WITH_EXPRESSIONS)].map((match) =>
    match[1].replace(new RegExp(EXPRESSION, "g"), " "),
  );
  return [...strings, ...jsx, ...split].filter((text) => /\s/.test(text.trim()));
}

/** The templates that tell a person to bring the screen up to date and try again, though what they say leaves nothing to try again. */
export function retryWhereNothingCanBeRetried(source: string): string[] {
  const NOTHING_TO_RETRY = /\bany more\b|\bno longer\b|\balready\b/i;
  return [...withoutComments(source).matchAll(COMMENT_OR_STRING)]
    .map((match) => match[0])
    .filter((token) => token.startsWith("`") && token.includes("${RELOAD_HINT}"))
    .filter((token) => NOTHING_TO_RETRY.test(token.replace(/\$\{[^}]*\}/g, "")))
    .map((token) => token.slice(1, -1));
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

  it("finds JSX text that an expression splits, with each expression taken out", () => {
    const tidy = (sentences: string[]) => sentences.map((sentence) => sentence.replace(/\s+/g, " ").trim());
    const sentences = tidy(
      sentencesIn(
        [
          "const a = <p>Please refresh {name} now</p>;",
          'const b = <p>{count} items: reload{" "}the page</p>;',
          'const c = <p className="x">Try to {action(1, { a: 2 })} refresh it</p>;',
          "const d = <p>Fine {value} text</p>;",
        ].join("\n"),
      ),
    );
    expect(sentences).toEqual(expect.arrayContaining(["Please refresh now", "items: reload the page", "Try to refresh it", "Fine text"]));
    expect(sentences.filter((sentence) => SAYS_REFRESH.test(sentence))).toEqual(
      expect.arrayContaining(["Please refresh now", "items: reload the page", "Try to refresh it"]),
    );
  });

  it("is not fooled by a brace or an angle bracket inside a string next to the text", () => {
    const sentences = sentencesIn('const a = <p title="a } b > c">Reload {x} please</p>;');
    expect(sentences.some((sentence) => SAYS_REFRESH.test(sentence) && /please/.test(sentence))).toBe(true);
  });
});

describe("retryWhereNothingCanBeRetried", () => {
  it("finds a template that says something is gone or already so, and then says to try again", () => {
    const source = [
      "const a = `Nothing to edit. It has no payment recorded any more. ${RELOAD_HINT}`;",
      "const b = `Asha has already moved out. ${RELOAD_HINT}`;",
      "const c = `The details are no longer there. ${RELOAD_HINT}`;",
    ].join("\n");
    expect(retryWhereNothingCanBeRetried(source)).toHaveLength(3);
  });

  it("leaves alone a message where trying again makes sense, and one that says to check instead", () => {
    const source = [
      "const a = `Asha was changed by someone else. ${RELOAD_HINT}`;",
      "const b = `Nothing to edit. It has no payment recorded any more. ${reloadThen(\"check the card\")}`;",
      "const c = `${name} already has a payment.`;",
      "// `It is no longer there. ${RELOAD_HINT}`",
    ].join("\n");
    expect(retryWhereNothingCanBeRetried(source)).toEqual([]);
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

  it("never say the step in words of their own: it is written in src/lib/recovery-hint.ts and nowhere else", () => {
    const found = sourceFiles(SRC)
      .filter((file) => path.relative(SRC, file) !== path.join("lib", "recovery-hint.ts"))
      .flatMap((file) =>
        sentencesIn(readFileSync(file, "utf8"))
          .filter((sentence) => /\banother tab\b|\bswitch (?:to )?(?:a|the)\b.*\btab\b/i.test(sentence))
          .map((sentence) => `${path.relative(SRC, file)}: ${sentence}`),
      );
    expect(found).toEqual([]);
  });

  it("never tell a person to try again where what the message says leaves nothing to try again", () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      retryWhereNothingCanBeRetried(readFileSync(file, "utf8")).map((text) => `${path.relative(SRC, file)}: ${text}`),
    );
    expect(found).toEqual([]);
  });
});
