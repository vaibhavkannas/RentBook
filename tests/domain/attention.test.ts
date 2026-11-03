import { describe, expect, it } from "vitest";
import { attentionFor } from "@/lib/attention";
import { baseRows, PORTIONS, tenancyRow } from "../support/fixtures";

// The rows of the home screen's "Needs attention" card, built from one snapshot: the overdue list, the agreement alerts and
// the hike alerts, each by its own rule (tested in overdue, alerts and report-copy), put together in the order the card shows.

const TODAY = "2026-10-17";

describe("attentionFor", () => {
  const quiet = { rows: [], portions: PORTIONS, tenancies: [] };

  it("is empty when nothing is due", () => {
    expect(attentionFor(quiet, TODAY, "2026-10")).toEqual([]);
  });

  it("lists overdue rent and the hike that is due, from the base Schedule on 17 October", () => {
    expect(attentionFor({ rows: baseRows(), portions: PORTIONS, tenancies: [] }, TODAY, "2026-10")).toEqual([
      { href: "/overdue?month=2026-10", text: "Rent overdue: 4 portions, ₹ 32,885", tone: "danger" },
      { href: "/alerts?month=2026-10#hikes", text: "Rent goes up soon for 1 portion", tone: "neutral" },
    ]);
  });

  it("adds an ended agreement and one that ends soon, between the two", () => {
    const tenancies = [
      tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2026-10-05" }),
      tenancyRow({ id: "t-3", portionId: "p3", tenant: "Chitra", agreementEnd: "2026-12-01" }),
    ];
    expect(attentionFor({ rows: baseRows(), portions: PORTIONS, tenancies }, TODAY, "2026-10").map((item) => item.text)).toEqual([
      "Rent overdue: 4 portions, ₹ 32,885",
      "1 agreement ended",
      "1 agreement ends within 60 days",
      "Rent goes up soon for 1 portion",
    ]);
  });

  it("carries the month in the links, and none when there is no month", () => {
    const snapshot = { rows: baseRows(), portions: PORTIONS, tenancies: [] };
    expect(attentionFor(snapshot, TODAY, "2026-10").map((item) => item.href)).toEqual(["/overdue?month=2026-10", "/alerts?month=2026-10#hikes"]);
    expect(attentionFor(snapshot, TODAY, null).map((item) => item.href)).toEqual(["/overdue", "/alerts#hikes"]);
  });

  it("follows the day it is given: before the 6th of October nothing of October is overdue", () => {
    const snapshot = { rows: baseRows(), portions: PORTIONS, tenancies: [] };
    expect(attentionFor(snapshot, "2026-10-05", "2026-10").map((item) => item.text)).not.toContain("Rent overdue: 4 portions, ₹ 32,885");
    expect(attentionFor(snapshot, "2026-10-05", "2026-10").some((item) => item.text.startsWith("Rent overdue"))).toBe(false);
  });
});
