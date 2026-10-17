import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
