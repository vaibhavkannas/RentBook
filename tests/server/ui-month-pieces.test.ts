import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterChip } from "@/components/ui/FilterChip";
import { Icon } from "@/components/ui/Icon";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { StatusDot } from "@/components/ui/StatusDot";
import { RING_RADIUS } from "@/lib/ring";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// The pieces the month screen is built from, rendered the way the server renders them.

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("ProgressRing", () => {
  it("is an image that says its figure, with the percent in the middle", () => {
    const out = html(createElement(ProgressRing, { percent: 62 }));
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="62% collected"');
    expect(out).toContain(">62%</span>");
  });

  it("draws a track and an arc whose empty part is what is not yet collected", () => {
    const circumference = 2 * Math.PI * RING_RADIUS;
    const out = html(createElement(ProgressRing, { percent: 25 }));
    expect(out).toContain(`stroke-dasharray="${circumference.toFixed(1)}"`);
    expect(out).toContain(`stroke-dashoffset="${(circumference * 0.75).toFixed(1)}"`);
    expect(html(createElement(ProgressRing, { percent: 100 }))).toContain('stroke-dashoffset="0.0"');
  });

  it("clamps what is out of range and has no colour of its own", () => {
    expect(html(createElement(ProgressRing, { percent: 400 }))).toContain("100%");
    expect(html(createElement(ProgressRing, { percent: -3 }))).toContain("0%");
    const out = html(createElement(ProgressRing, { percent: 40 }));
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(out).toContain("stroke-accent");
  });

  it("does not animate (no transition on the arc)", () => {
    expect(html(createElement(ProgressRing, { percent: 40 }))).not.toMatch(/transition|animate/);
  });
});

describe("StatusDot", () => {
  it.each([
    ["paid", "bg-success-bg"],
    ["pending", "bg-warn-bg"],
    ["vacant", "bg-off-bg"],
  ] as const)("draws %s in its tone, hidden from a screen reader", (status, tone) => {
    const out = html(createElement(StatusDot, { status }));
    expect(out).toContain(tone);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("<svg");
  });

  it("gives each status its own icon, not only its own colour", () => {
    const shapes = (["paid", "pending", "vacant"] as const).map((status) => html(createElement(StatusDot, { status })).match(/<svg[\s\S]*<\/svg>/)![0]);
    expect(new Set(shapes).size).toBe(3);
  });
});

describe("FilterChip", () => {
  const chip = (selected: boolean) => html(createElement(FilterChip, { selected, count: 3 }, "Pending"));

  it("is a button with its count, pressed when chosen", () => {
    expect(chip(true)).toContain('aria-pressed="true"');
    expect(chip(false)).toContain('aria-pressed="false"');
    expect(chip(true)).toContain(">3</span>");
    expect(chip(true)).toContain('type="button"');
  });

  it("is 44 px high and answers a press", () => {
    expect(smallTargets(chip(false))).toEqual([]);
    expect(unpressedTargets(chip(false))).toEqual([]);
  });

  it("fills the chosen one, so the choice does not rest on a colour alone", () => {
    expect(chip(true)).toContain("bg-foreground");
    expect(chip(false)).not.toContain("bg-foreground");
  });
});

describe("Icon", () => {
  it("draws a hidden svg in the colour of the text round it", () => {
    const out = html(createElement(Icon, { name: "check" }));
    expect(out).toMatch(/^<svg aria-hidden="true"/);
    expect(out).toContain('stroke="currentColor"');
  });
});
