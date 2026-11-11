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

describe("AttentionCard", () => {
  it("draws nothing for an empty list: no box, no heading", () => {
    expect(html([])).toBe("");
  });

  it("is a section named Needs attention, with a heading only a screen reader reads (the rows are the card)", () => {
    const out = html(ITEMS);
    expect(out).toMatch(/^<section aria-label="Needs attention" class="[^"]*">/);
    expect(out).toMatch(/<h2 class="sr-only">Needs attention<\/h2>/);
  });

  it("has a row for each item, in order, each a link to its screen with its words", () => {
    const links = [...html(ITEMS).matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
      href: match[1],
      text: match[2].replace(/<[^>]+>/g, "").trim(),
    }));
    expect(links).toEqual(ITEMS.map((item) => ({ href: item.href.replace(/&/g, "&amp;"), text: item.text })));
  });

  it("makes each row the full width of the card and at least 44 px tall, and it answers a press", () => {
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

  it("tints each row in the colour of its tone and gives it an icon and an arrow, both hidden from a screen reader, so the words alone say what it is", () => {
    const rows = html(ITEMS).match(/<a [^>]*>/g) ?? [];
    expect(rows[0]).toContain("bg-danger-bg text-danger-ink");
    expect(rows[1]).toContain("bg-danger-bg text-danger-ink");
    expect(rows[2]).toContain("bg-warn-bg text-warn-ink");
    expect(rows[3]).toContain("bg-accent-soft text-accent");
    // Each row has two svgs (its icon and the arrow), and neither is read out.
    const out = html(ITEMS);
    expect(out.match(/<svg aria-hidden="true"/g)).toHaveLength(8);
    expect(out.match(/<svg(?! aria-hidden="true")/g)).toBeNull();
  });

  it("lists the rows in a list, so a screen reader says how many there are", () => {
    const out = html(ITEMS);
    expect(out).toMatch(/<ul [^>]*>/);
    expect(out.match(/<li/g)).toHaveLength(4);
  });

  it("is a server component: it reads nothing in the browser and needs no client code", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../src/components/AttentionCard.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).not.toMatch(/\buse(State|Effect|Ref|Router|SearchParams|Pathname)\b/);
  });
});
