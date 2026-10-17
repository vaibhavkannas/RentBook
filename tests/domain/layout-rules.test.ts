import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import { LAYOUT_RULES } from "@/lib/layout-rules";
import { SETTINGS_RANGE } from "@/lib/sheets/settings-store";
import { TENANT_HEADERS } from "@/lib/sheets/tenants-store";

// What the owner's Sheet needs, in plain words, for the Set up page and SETUP.md. The rules are what is left of the audit
// of the Sheet's layout after wave 3 loosened it, so these tests tie the words to the code that holds them.

const rule = (topic: string) => {
  const found = LAYOUT_RULES.filter((entry) => entry.topic === topic);
  expect(found, topic).toHaveLength(1);
  return found[0].text;
};

describe("LAYOUT_RULES", () => {
  it("has a short heading and a sentence or two for each part of the Sheet", () => {
    expect(LAYOUT_RULES.map((entry) => entry.topic)).toEqual([
      "Schedule tab",
      "Header row",
      "Portion columns",
      "Total column",
      "Month rows",
      "Settings tab",
      "Payments Log tab",
      "Tenants tab",
      "Naming a tab",
      "What the app never does",
    ]);
    for (const { topic, text } of LAYOUT_RULES) {
      expect(topic.length, topic).toBeLessThan(30);
      expect(text.endsWith("."), topic).toBe(true);
      expect(text, topic).not.toMatch(/\s{2}|\n/);
    }
  });

  it("says the Schedule tab is found by its name, then by the name without regard to capitals or spaces", () => {
    expect(rule("Schedule tab")).toContain("SCHEDULE_TAB");
    expect(rule("Schedule tab")).toMatch(/capitals or spaces/);
  });

  it("says where the header row is and what is in it", () => {
    expect(rule("Header row")).toContain("first 25 rows");
    expect(rule("Header row")).toContain("Month");
    expect(rule("Header row")).toMatch(/Tenant, a Count and an Amount/);
  });

  it("says each portion header must appear once, and that other columns may sit between them", () => {
    expect(rule("Portion columns")).toMatch(/once/);
    expect(rule("Portion columns")).toMatch(/other columns/i);
  });

  it("says what Prepare my Sheet needs to start Settings the first time: Tenant, Count and Amount in order, numbered for the later portions", () => {
    const text = rule("Portion columns");
    expect(text).toContain("Prepare my Sheet");
    expect(text).toContain("Tenant, Count and Amount in that order");
    expect(text).toContain("Tenant2, Count2, Amount2");
    expect(text).toMatch(/Once Settings exists/);
  });

  it("says the total column is optional, and what happens without it", () => {
    const text = rule("Total column");
    expect(text).toContain("TOTAL_HEADER");
    expect(text).toMatch(/optional/);
    expect(text).toMatch(/up to date/);
  });

  it("says what a month row is, that they are in order, that the row under the last month is empty, and how far the app reads", () => {
    const text = rule("Month rows");
    expect(text).toContain("Oct-26");
    expect(text).toMatch(/in order/);
    expect(text).toMatch(/under the last month/);
    expect(text).toContain("ZZ");
  });

  it("says Settings is in columns A to G, rows 2 to 50, and that column H, Active, switches a portion off, as the app reads it", () => {
    expect(SETTINGS_RANGE).toBe("A1:H50");
    const text = rule("Settings tab");
    expect(text).toContain("columns A to G");
    expect(text).toContain("rows 2 to 50");
    expect(text).toContain("column H, headed Active");
    expect(text).toMatch(/switched off \(No\)/);
  });

  it("says the Payments Log is used by column position, A to I, and that a heading already in H or I stays", () => {
    const text = rule("Payments Log tab");
    expect(text).toContain("A to I");
    expect(text).toMatch(/column H or I/);
    expect(text).toMatch(/still writes there/);
  });

  it("says the Tenants tab has its fifteen headers in A to O", () => {
    expect(TENANT_HEADERS).toHaveLength(15);
    const text = rule("Tenants tab");
    expect(text).toContain("15 headers");
    expect(text).toContain("columns A to O");
  });

  it("says to rename a tab in the Sheet first, then set the variable, and why", () => {
    const text = rule("Naming a tab");
    for (const name of ["SETTINGS_TAB", "LOG_TAB", "TENANTS_TAB"]) expect(text).toContain(name);
    expect(text).toMatch(/rename the tab in your Sheet first, then set the variable/);
    expect(text).toMatch(/new tab/);
    expect(text).toMatch(/default/);
  });

  it("says the app adds to the Sheet and deletes no row, column or tab", () => {
    expect(rule("What the app never does")).toMatch(/never deletes a row, a column or a tab/);
  });

  it("names the product through BRAND, which the rest of the source does too", () => {
    expect(JSON.stringify(LAYOUT_RULES)).toContain(BRAND.name);
  });
});
