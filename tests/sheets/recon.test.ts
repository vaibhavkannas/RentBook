import { describe, expect, it } from "vitest";
import { describeSheet } from "@/lib/sheets/recon";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

describe("describeSheet", () => {
  it("summarises a healthy sheet without writing anything", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    const report = await describeSheet(fake, "Schedule", TOTAL_HEADER);

    expect(report.problems).toEqual([]);
    expect(report.headerRow).toBe(3);
    expect(report.portions).toHaveLength(5);
    expect(report.monthFormat).toBe('text such as "Sep-26"');
    expect([report.firstMonth, report.lastMonth, report.monthRows]).toEqual([
      "2026-08",
      "2026-09",
      2,
    ]);
    expect(report.lastDataRow).toBe(5);
    expect(report.totalCellIsFormula).toBe(true);
    expect(report.totalCellSample).toBe("=D5+G5+J5+M5+P5");
    expect(report.rowBelowTableEmpty).toBe(true);
    expect(report.hasSettingsTab).toBe(false);
    expect([...fake.tabs.keys()]).toEqual(["Schedule"]);
    expect(fake.calls.filter((c) => ["addTab", "updateValues", "cloneRow", "appendRow"].includes(c))).toEqual([]);
  });

  it("reports date-cell months", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule("serial") });
    expect((await describeSheet(fake, "Schedule", TOTAL_HEADER)).monthFormat).toBe("date cells");
  });

  it("flags a missing tab, a wrong total header, and a non-empty row below", async () => {
    const missing = await describeSheet(new FakeGateway({ Other: [] }), "Schedule", TOTAL_HEADER);
    expect(missing.problems[0]).toMatch(/Tab "Schedule" not found/);

    const wrongTotal = await describeSheet(
      new FakeGateway({ Schedule: baseSchedule() }),
      "Schedule",
      "Per Month",
    );
    expect(wrongTotal.problems[0]).toMatch(/Header "Per Month" was not found/);

    const schedule = baseSchedule();
    schedule.push(["Note"]);
    const crowded = await describeSheet(new FakeGateway({ Schedule: schedule }), "Schedule", TOTAL_HEADER);
    expect(crowded.rowBelowTableEmpty).toBe(false);
    expect(crowded.problems[0]).toMatch(/Row 6/);
  });
});
