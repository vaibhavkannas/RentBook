import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AttentionCard from "@/components/AttentionCard";
import type { AttentionItem } from "@/lib/report-copy";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// The home screen's "Needs attention" card: a row for each thing that is due, each a link to the screen that explains it. It is
// drawn from the rows `attentionItems` builds; the card only draws them.

const ITEMS: AttentionItem[] = [
  { href: "/overdue?month=2026-10", text: "Rent overdue: 4 portions, ₹ 32,885", tone: "danger" },
  { href: "/alerts?month=2026-10", text: "1 agreement ended", tone: "danger" },
  { href: "/alerts?month=2026-10", text: "1 agreement ends within 60 days", tone: "warn" },
  { href: "/alerts?month=2026-10#hikes", text: "Rent goes up soon for 1 portion", tone: "neutral" },
];

const html = (items: AttentionItem[]) => renderToStaticMarkup(createElement(AttentionCard, { items }));

const collapsed = (items: AttentionItem[]) => html(items).match(/<button[\s\S]*?<\/button>/)?.[0] ?? "";

describe("AttentionCard", () => {
  it("draws nothing for an empty list: no box, no heading", () => {
    expect(html([])).toBe("");
  });

  it("draws one item as a single strip, as it always did, with no toggle", () => {
    const out = html([ITEMS[0]]);
    expect(out).not.toContain("<button");
    expect(out).not.toContain("aria-expanded");
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain("Rent overdue: 4 portions");
  });

  it("is a section named Needs attention, with a heading only a screen reader reads", () => {
    const out = html(ITEMS);
    expect(out).toMatch(/^<section aria-label="Needs attention" class="[^"]*">/);
    expect(out).toMatch(/<h2 class="sr-only">Needs attention<\/h2>/);
  });

  it("is collapsed to begin with: one 44 px row with the count, the most pressing headline and how many more", () => {
    const row = collapsed(ITEMS);
    expect(row).toContain('aria-expanded="false"');
    expect(row).toMatch(/aria-controls="[^"]+"/);
    expect(row).toContain("Needs attention");
    expect(row).toMatch(/>4<\/span>/);
    expect(row).toMatch(/Rent overdue: 4 portions, ₹.32,885/);
    expect(row).toContain("+3 more");
    expect(row).toMatch(/class="[^"]*\bmin-h-11\b[^"]*\bw-full\b|class="[^"]*\bw-full\b[^"]*\bmin-h-11\b/);
    expect(smallTargets(row)).toEqual([]);
    expect(unpressedTargets(row)).toEqual([]);
  });

  it("colours the row by the most urgent tone among the items, with the count in a badge of that tone", () => {
    expect(collapsed(ITEMS)).toContain("bg-danger-bg text-danger-ink");
    expect(collapsed([ITEMS[2], ITEMS[3]])).toContain("bg-warn-bg text-warn-ink");
    expect(collapsed([ITEMS[3], { ...ITEMS[3], text: "other" }])).toContain("bg-accent-soft text-accent");
  });

  it("keeps every row, in order, each a link to its screen with its words, in the panel the row opens (hidden while closed)", () => {
    const out = html(ITEMS);
    const controls = /aria-controls="([^"]+)"/.exec(out)![1];
    expect(out).toContain(`id="${controls}" class="accordion" data-open="false"`);
    const links = [...out.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
      href: match[1],
      text: match[2].replace(/<[^>]+>/g, "").trim(),
    }));
    expect(links).toEqual(ITEMS.map((item) => ({ href: item.href.replace(/&/g, "&amp;"), text: item.text })));
  });

  it("makes each row of the panel the full width of the card and at least 44 px tall, and it answers a press", () => {
    const out = html(ITEMS);
    const rows = out.match(/<a [^>]*>/g) ?? [];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toMatch(/class="[^"]*\bw-full\b/);
      expect(row).toMatch(/class="[^"]*\bmin-h-11\b/);
      expect(row).toMatch(/class="[^"]*\bpress\b/);
    }
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
  });

  it("tints each row of the panel in the colour of its tone, with icons that no screen reader reads", () => {
    const rows = html(ITEMS).match(/<a [^>]*>/g) ?? [];
    expect(rows[0]).toContain("bg-danger-bg text-danger-ink");
    expect(rows[1]).toContain("bg-danger-bg text-danger-ink");
    expect(rows[2]).toContain("bg-warn-bg text-warn-ink");
    expect(rows[3]).toContain("bg-accent-soft text-accent");
    const out = html(ITEMS);
    // the row has an icon and a chevron, each link of the panel two more
    expect(out.match(/<svg aria-hidden="true"/g)).toHaveLength(10);
    expect(out.match(/<svg(?! aria-hidden="true")/g)).toBeNull();
  });

  it("lists the rows in a list, so a screen reader says how many there are", () => {
    const out = html(ITEMS);
    expect(out).toMatch(/<ul [^>]*>/);
    expect(out.match(/<li/g)).toHaveLength(4);
  });

  it("turns the chevron when open and moves nothing but a transform and the panel's own height", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../src/components/AttentionList.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/rotate-90/);
    expect(source).toMatch(/transition-transform motion-reduce:transition-none/);
    expect(source).toMatch(/className="accordion"|"accordion"/);
  });

  it("keeps its state in the card (a small client component), so toggling draws the card and not the screen", async () => {
    const { readFileSync } = await import("node:fs");
    const list = readFileSync(new URL("../../src/components/AttentionList.tsx", import.meta.url), "utf8");
    expect(list).toMatch(/^"use client";/);
    expect(list).toMatch(/useState\(false\)/);
    const screen = readFileSync(new URL("../../src/components/MonthScreen.tsx", import.meta.url), "utf8");
    expect(screen).not.toMatch(/attentionOpen|setAttention/);
  });

  it("is a server component at its entry: it reads nothing in the browser and needs no client code", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../src/components/AttentionCard.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).not.toMatch(/\buse(State|Effect|Ref|Router|SearchParams|Pathname)\b/);
  });
});
