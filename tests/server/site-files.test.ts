import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("robots", () => {
  it("asks every crawler to stay away from everything", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("security.txt", () => {
  const text = readFileSync(join(process.cwd(), "public", ".well-known", "security.txt"), "utf8");
  const fields = new Map(
    text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "" && !line.startsWith("#"))
      .map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon), line.slice(colon + 1).trim()] as const;
      }),
  );

  it("says where to report a problem: GitHub's private advisory form", () => {
    expect(fields.get("Contact")).toBe("https://github.com/vaibhavkannas/RentBook/security/advisories/new");
  });

  it("has an Expires date in the form the standard asks for (RFC 9116: ISO 8601, UTC)", () => {
    const expires = fields.get("Expires");
    expect(expires).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Number.isNaN(Date.parse(expires!))).toBe(false);
  });

  it("names no personal email address", () => {
    expect(text).not.toMatch(/@/);
  });
});
