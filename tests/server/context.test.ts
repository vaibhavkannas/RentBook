import { afterEach, describe, expect, it, vi } from "vitest";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { FakeGateway } from "../support/fake-gateway";

vi.mock("@/lib/sheets/google-gateway", () => ({ GoogleSheetsGateway: { fromServiceAccount: vi.fn() } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The context for an environment, with the Google gateway replaced by `google`. The context is kept per server, so each test loads it fresh. */
async function contextFor(env: Record<string, string>, google: SheetsGateway) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const { GoogleSheetsGateway } = await import("@/lib/sheets/google-gateway");
  vi.mocked(GoogleSheetsGateway.fromServiceAccount).mockReturnValue(google as never);
  const { getSheetsContext } = await import("@/lib/server/context");
  return { ctx: getSheetsContext(), fromServiceAccount: vi.mocked(GoogleSheetsGateway.fromServiceAccount) };
}

const BASE = {
  GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
  SHEET_ID: "sheet-id",
  ALLOWED_EMAILS: "owner@example.com",
};

describe("getSheetsContext", () => {
  it("hands the Google gateway's tabs to the app under the app's own names", async () => {
    const fake = new FakeGateway({ schedule: [], Settings: [], "RentBook Tenants": [], Tenants: [["theirs"]] });
    const { ctx, fromServiceAccount } = await contextFor(
      { ...BASE, TENANTS_TAB: "RentBook Tenants", SCHEDULE_TAB: "Schedule" },
      fake,
    );
    expect(fromServiceAccount).toHaveBeenCalledWith("{}", "sheet-id");
    expect(ctx.scheduleTab).toBe("Schedule");
    expect(await ctx.gateway.listTabs()).toEqual(["Schedule", "Settings", "Tenants"]);
  });

  it("does not need TOTAL_HEADER: it is null", async () => {
    const { ctx } = await contextFor(BASE, new FakeGateway({ Schedule: [] }));
    expect(ctx.totalHeader).toBeNull();
  });

  it("passes TOTAL_HEADER on when it is set", async () => {
    const { ctx } = await contextFor({ ...BASE, TOTAL_HEADER: "Total Rent" }, new FakeGateway({ Schedule: [] }));
    expect(ctx.totalHeader).toBe("Total Rent");
  });

  it("refuses tab names that name one tab twice, before it asks Google for anything", async () => {
    const fake = new FakeGateway({ Schedule: [] });
    await expect(contextFor({ ...BASE, TENANTS_TAB: "Schedule" }, fake)).rejects.toThrow(/must each name a different tab/);
    expect(fake.calls).toEqual([]);
  });
});

describe("sheetsGatewayFor", () => {
  async function gatewayFor(env: Record<string, string>, google: SheetsGateway, sheetId?: string) {
    vi.resetModules();
    const { GoogleSheetsGateway } = await import("@/lib/sheets/google-gateway");
    vi.mocked(GoogleSheetsGateway.fromServiceAccount).mockReturnValue(google as never);
    const { sheetsGatewayFor } = await import("@/lib/server/context");
    const { readEnv } = await import("@/lib/server/env");
    const gateway = sheetsGatewayFor(readEnv({ ...BASE, ...env }), sheetId);
    return { gateway, fromServiceAccount: vi.mocked(GoogleSheetsGateway.fromServiceAccount) };
  }

  it("is what the scripts use: the Google gateway for the environment's Sheet, under the app's tab names", async () => {
    const fake = new FakeGateway({ rent: [], "my settings": [], "Payments Log": [], Tenants: [] });
    const { gateway, fromServiceAccount } = await gatewayFor({ SCHEDULE_TAB: "Rent", SETTINGS_TAB: "My Settings" }, fake);
    expect(fromServiceAccount).toHaveBeenCalledWith("{}", "sheet-id");
    expect(await gateway.listTabs()).toEqual(["Rent", "Settings", "Payments Log", "Tenants"]);
  });

  it("can be pointed at another Sheet, such as the test copy, and still finds the tabs by their names", async () => {
    const fake = new FakeGateway({ Schedule: [["x"]] });
    const { gateway, fromServiceAccount } = await gatewayFor({}, fake, "test-copy-id");
    expect(fromServiceAccount).toHaveBeenCalledWith("{}", "test-copy-id");
    expect(await gateway.getValues("Schedule", "A1", "UNFORMATTED_VALUE")).toEqual([["x"]]);
  });
});
