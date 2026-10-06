import { describe, expect, it } from "vitest";
import { configError } from "@/lib/errors";
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
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((call) => call === "listTabs" || call === "getValues")).toBe(true);
  });

  it("puts a failure to list the tabs into problems instead of throwing", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    fake.failOn.add("listTabs");
    const plain = await describeSheet(fake, "Schedule", TOTAL_HEADER);
    expect(plain.problems).toEqual(["Error: listTabs failed"]);
    expect(plain.tabs).toEqual([]);

    const denied = new FakeGateway({ Schedule: baseSchedule() });
    denied.listTabs = async () => {
      throw configError("Google denied access. Share the Sheet with the service account as Editor.");
    };
    const report = await describeSheet(denied, "Schedule", TOTAL_HEADER);
    expect(report.problems).toEqual([
      "Google denied access. Share the Sheet with the service account as Editor.",
    ]);
  });

  it("flags a Sheet with no header row", async () => {
    const fake = new FakeGateway({ Schedule: [["Just a title"]] });
    const report = await describeSheet(fake, "Schedule", TOTAL_HEADER);
    expect(report.problems[0]).toMatch(/No header row containing "Month"/);
    expect(report.headerRow).toBeNull();
  });

  it("reports an unreadable Tenant/Count/Amount grouping by name", async () => {
    const schedule = baseSchedule();
    (schedule[2] as string[])[2] = "Cnt";
    const report = await describeSheet(new FakeGateway({ Schedule: schedule }), "Schedule", TOTAL_HEADER);
    expect(report.problems[0]).toMatch(/must be followed by a Count and an Amount/);
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
