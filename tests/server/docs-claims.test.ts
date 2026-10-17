import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONNECTION_NEEDS_ATTENTION } from "@/lib/errors";
import { SOMETHING_WENT_WRONG_MESSAGE } from "@/lib/request-copy";

/**
 * The docs name files ("the Sign out button is a Server Action in src/app/more/page.tsx"). A claim that goes stale when
 * a file moves is worse than none, so this reads the docs: every file they name under src, tests or scripts must exist,
 * and the files named as holding Server Actions must hold one.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOCS = ["README.md", "SETUP.md", "SECURITY.md", "docs/product/THREAT-MODEL.md"];
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

describe.each(DOCS)("%s", (doc) => {
  const text = read(doc);

  it("names only files that exist", () => {
    const named = [...text.matchAll(/`((?:src|tests|scripts)\/[^`\s]+?)`/g)]
      .map((match) => match[1].replace(/[.,:;)]+$/, ""))
      // a pattern or an example, not a file
      .filter((path) => !/[*{}<>]|\.\.\.|\[/.test(path));
    const missing = named.filter((path) => !existsSync(`${ROOT}${path}`));
    expect(missing).toEqual([]);
  });
});

describe("the threat model's claim about the sign-in and sign-out buttons", () => {
  const sentence = /sign-in and sign-out buttons are Server Actions \(([^)]*)\)/.exec(read("docs/product/THREAT-MODEL.md"))?.[1] ?? "";
  const files = [...sentence.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

  it("names two files", () => {
    expect(files).toEqual(["src/app/signin/page.tsx", "src/app/more/page.tsx"]);
  });

  it("names files that hold a Server Action each", () => {
    for (const file of files) expect(read(file), file).toContain('"use server"');
  });

  it("no longer finds a Sign out on the home page, which has no Server Action left", () => {
    expect(read("src/app/page.tsx")).not.toContain('"use server"');
    expect(read("src/app/page.tsx")).not.toContain("signOut");
  });
});

describe("the threat model's quotes of what a person reads", () => {
  // A quoted message goes stale when its words change in the code, so each is read from the doc and compared with the
  // code's own text.
  const doc = read("docs/product/THREAT-MODEL.md");
  const quoted = (before: string) => new RegExp(`${before}\\s*"([^"]+)"`).exec(doc)?.[1];

  it("quotes what everyone but the owner reads about a connection problem as the code says it", () => {
    expect(quoted("Everyone else reads")).toBe(CONNECTION_NEEDS_ATTENTION);
  });

  it("quotes what an error nobody expected reaches the browser as, as the code says it", () => {
    expect(quoted("reaches the browser as")).toBe(SOMETHING_WENT_WRONG_MESSAGE);
    expect(SOMETHING_WENT_WRONG_MESSAGE).toBe("Something went wrong on our side. Try again.");
  });

  it("has the server answer an unexpected error with that same text", () => {
    expect(read("src/lib/server/http.ts")).toMatch(/message: SOMETHING_WENT_WRONG_MESSAGE/);
  });
});
