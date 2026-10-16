import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Code that holds secrets or talks to Google starts with `import "server-only"`, so a build fails if a browser
 * bundle ever reaches it. These tests check the marker is there, and that nothing the browser loads imports a file
 * that has it.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const MARKER = 'import "server-only";';

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(SRC, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => path.join(dir, name).split(path.sep).join("/"))
    .sort();
}

const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

/** The files that must carry the marker: sign-in setup, everything in src/lib/server, and the Google gateway. */
const MARKED = ["auth.ts", ...sourceFiles("lib/server"), "lib/sheets/google-gateway.ts"];

/** The source without the comments and blank lines in front of its first statement. */
function afterLeadingComments(source: string): string {
  return source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)+/, "");
}

describe('import "server-only"', () => {
  it("is found for the files that must have it", () => {
    expect(MARKED.length).toBeGreaterThan(10);
    expect(MARKED).toEqual(
      expect.arrayContaining(["auth.ts", "lib/server/auth-guard.ts", "lib/server/schemas.ts", "lib/sheets/google-gateway.ts"]),
    );
  });

  it.each(MARKED)("is the first statement of %s", (file) => {
    expect(afterLeadingComments(read(file)).startsWith(MARKER)).toBe(true);
  });
});

/** The module names a file imports or re-exports at run time. `import type` is left out: it is gone after the build. */
function importsOf(source: string): string[] {
  const names: string[] = [];
  const staticImport = /^[ \t]*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) names.push(match[1]);
  }
  return names;
}

/** The file in src that a module name points to, or null when it is a package (or not a file of ours). */
function resolveImport(from: string, name: string): string | null {
  const base = name.startsWith("@/") ? name.slice(2) : name.startsWith(".") ? path.posix.join(path.posix.dirname(from), name) : null;
  if (base === null) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(path.join(SRC, candidate))) ?? null;
}

const startsAsClientModule = (source: string) => /^["']use client["']/.test(afterLeadingComments(source));

describe("the browser bundle", () => {
  const all = sourceFiles(".");
  const clientEntries = all.filter((file) => startsAsClientModule(read(file)));

  it("has client components to check", () => {
    expect(clientEntries).toEqual(expect.arrayContaining(["components/PortionBoard.tsx", "components/SettingsForm.tsx"]));
  });

  it("never imports a file that is marked server-only, directly or through another file", () => {
    const marked = new Set(MARKED);
    const reached: string[] = [];
    for (const entry of clientEntries) {
      const seen = new Set<string>([entry]);
      const queue: Array<{ file: string; chain: string[] }> = [{ file: entry, chain: [entry] }];
      while (queue.length > 0) {
        const { file, chain } = queue.shift()!;
        for (const name of importsOf(read(file))) {
          const next = resolveImport(file, name);
          if (next === null || seen.has(next)) continue;
          seen.add(next);
          if (marked.has(next)) reached.push([...chain, next].join(" -> "));
          else queue.push({ file: next, chain: [...chain, next] });
        }
      }
    }
    expect(reached).toEqual([]);
  });
});
