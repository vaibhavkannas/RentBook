import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The functions run in Mumbai (bom1), near the owner and closer to Google than the default US region, which saves a round trip
// across the world on every request. Changing the region is a deployment decision, so it is pinned here.
describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { regions?: string[] };

  it("runs the functions in Mumbai only", () => {
    expect(config.regions).toEqual(["bom1"]);
  });
});
