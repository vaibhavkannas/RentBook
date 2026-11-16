import { describe, expect, it } from "vitest";
import type { AttentionItem } from "@/lib/report-copy";
import { attentionSummary } from "@/lib/attention-summary";

const item = (text: string, tone: AttentionItem["tone"]): AttentionItem => ({ href: "/x", text, tone });

describe("the collapsed Needs attention row", () => {
  it("counts the items and takes the most pressing one (the first) as its headline, with how many more there are", () => {
    const summary = attentionSummary([
      item("Rent overdue: 2 portions, ₹ 31,335", "danger"),
      item("1 agreement ended", "danger"),
      item("1 agreement ends within 60 days", "warn"),
      item("Rent goes up soon for 1 portion", "neutral"),
    ]);
    expect(summary).toEqual({ count: 4, headline: "Rent overdue: 2 portions, ₹ 31,335", more: "+3 more", tone: "danger" });
  });

  it("says nothing more for two items but one: +1 more", () => {
    expect(attentionSummary([item("a", "warn"), item("b", "neutral")]).more).toBe("+1 more");
  });

  it("is danger when any row is red, even if it is not the first; else warn when any is amber; else neutral", () => {
    expect(attentionSummary([item("a", "warn"), item("b", "danger")]).tone).toBe("danger");
    expect(attentionSummary([item("a", "neutral"), item("b", "warn")]).tone).toBe("warn");
    expect(attentionSummary([item("a", "neutral"), item("b", "neutral")]).tone).toBe("neutral");
  });

  it("has no more to say for one item", () => {
    expect(attentionSummary([item("only", "warn")])).toEqual({ count: 1, headline: "only", more: null, tone: "warn" });
  });
});
