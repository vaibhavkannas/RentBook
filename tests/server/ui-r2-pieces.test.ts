import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChipLink } from "@/components/ui/ChipLink";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/IconTile";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { StatusDot } from "@/components/ui/StatusDot";
import { SummaryCard } from "@/components/ui/SummaryCard";
import { pillClasses } from "@/lib/ui-classes";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

// The pieces the other screens share with the month screen, rendered the way the server renders them.

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("pills", () => {
  it("are fully round, as in the month screen's rows", () => {
    expect(pillClasses("danger")).toContain("rounded-full");
    expect(pillClasses("danger")).not.toContain("rounded-chip");
  });
});

describe("StatusDot overdue", () => {
  it("is red with its own mark, not only its own colour", () => {
    const overdue = html(createElement(StatusDot, { status: "overdue" }));
    expect(overdue).toContain("bg-danger-bg");
    expect(overdue).toContain("text-danger-ink");
    expect(overdue).toContain('aria-hidden="true"');
    const others = (["paid", "pending", "vacant"] as const).map((status) => html(createElement(StatusDot, { status })).match(/<svg[\s\S]*<\/svg>/)![0]);
    expect(others).not.toContain(overdue.match(/<svg[\s\S]*<\/svg>/)![0]);
  });
});

describe("Icon", () => {
  const NAMES: IconName[] = ["month", "list", "dots", "bang", "user", "out", "cog", "check", "rotate", "left", "right"];
  it.each(NAMES)("draws %s as a decoration", (name) => {
    const out = html(createElement(Icon, { name }));
    expect(out).toContain("<svg");
    expect(out).toContain('aria-hidden="true"');
  });
});

describe("SectionLabel", () => {
  it("is a small uppercase heading of the level it is given", () => {
    const out = html(createElement(SectionLabel, { as: "h2", id: "x" }, "History"));
    expect(out).toMatch(/^<h2 id="x" class="[^"]*uppercase[^"]*">History<\/h2>$/);
  });
});

describe("SummaryCard", () => {
  it("shows a label, the big figure and a note, in a labelled section", () => {
    const out = html(createElement(SummaryCard, { label: "Owed", figure: "₹ 9,000", note: "Rent is due on the 1st", ariaLabel: "Overdue summary" }));
    expect(out).toContain('aria-label="Overdue summary"');
    expect(out).toContain("Owed");
    expect(out).toContain("₹ 9,000");
    expect(out).toContain("Rent is due on the 1st");
    expect(out).toContain("shadow-card");
  });
});

describe("IconTile", () => {
  it("is a decoration", () => {
    expect(html(createElement(IconTile, { name: "cog" }))).toContain('aria-hidden="true"');
  });
});

describe("ChipLink", () => {
  const chip = (selected: boolean) => html(createElement(ChipLink, { href: "/activity?show=logged", selected }, "Logged"));
  it("is a 44 px link that answers a press, marked current when chosen", () => {
    expect(smallTargets(chip(true))).toEqual([]);
    expect(unpressedTargets(chip(true))).toEqual([]);
    expect(chip(true)).toContain('aria-current="true"');
    expect(chip(false)).not.toContain("aria-current");
  });
  it("is filled in ink when chosen, as the month screen's filter chips are", () => {
    expect(chip(true)).toContain("bg-foreground");
    expect(chip(false)).toContain("bg-surface");
  });
});
