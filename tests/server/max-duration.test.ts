import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A page or a route that reads or writes the Sheet must say how long Google may keep it waiting: Next passes
// `maxDuration` on to the host, which cuts the request off then. Each Google call gives up after 10 seconds.

const APP = join(process.cwd(), "src", "app");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /^(page\.tsx|route\.ts)$/.test(entry.name) ? [path] : [];
  });
}

const touchesTheSheet = (source: string) => source.includes("getSheetsContext");

const entries = filesUnder(APP).map((path) => ({
  name: relative(APP, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8"),
}));

describe("maxDuration", () => {
  it("finds the pages and routes that use the Sheet", () => {
    const names = entries.filter((entry) => touchesTheSheet(entry.source)).map((entry) => entry.name).sort();
    expect(names).toEqual([
      "activity/page.tsx",
      "api/payments/log-retry/route.ts",
      "api/payments/route.ts",
      "api/payments/undo/route.ts",
      "api/portions/active/route.ts",
      "api/portions/order/route.ts",
      "api/portions/route.ts",
      "api/settings/route.ts",
      "api/setup/prepare/route.ts",
      "api/tenancies/move-out/route.ts",
      "api/tenancies/route.ts",
      "diagnostics/page.tsx",
      "page.tsx",
      "settings/page.tsx",
      "setup/page.tsx",
      "tenants/[portionId]/page.tsx",
    ]);
  });

  it.each(entries.filter((entry) => touchesTheSheet(entry.source)).map((entry) => [entry.name, entry.source]))(
    "is 15 seconds in %s",
    (_name, source) => {
      expect(source).toMatch(/^export const maxDuration = 15;$/m);
    },
  );

  it("is not set where the Sheet is not used", () => {
    for (const entry of entries.filter((entry) => !touchesTheSheet(entry.source))) {
      expect(entry.source, entry.name).not.toContain("maxDuration");
    }
  });
});
