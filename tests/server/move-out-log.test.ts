import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetsContext } from "@/lib/sheets/service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// A refusal is logged by the route as one line, at info, with the text of the error. A tenant's name must never be in it.

const state = vi.hoisted(() => ({ ctx: null as unknown }));
const auth = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => state.ctx }));
vi.mock("@/lib/server/freshness", () => ({ markWritten: vi.fn(async () => undefined), readWrittenAt: vi.fn(async () => undefined) }));

import { POST } from "@/app/api/tenancies/move-out/route";
import { getSettings } from "@/lib/sheets/service";

let logs: LogSpies;
beforeEach(async () => {
  logs = captureLogs();
  process.env.ALLOWED_EMAILS = "owner@example.com";
  vi.stubEnv("AUTH_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
  vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
  auth.mockResolvedValue({ user: { email: "owner@example.com" } });
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  await getSettings(ctx);
  state.ctx = ctx;
});
afterEach(() => {
  for (const spy of Object.values(logs)) spy.mockRestore();
  vi.unstubAllEnvs();
  delete process.env.ALLOWED_EMAILS;
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/tenancies/move-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("a move-out refused for a day before the tenant's rent", () => {
  it("tells the owner in plain words, without the tenant, and logs a line with no tenant name in it", async () => {
    // Asha has September rent logged in the base Schedule; the day is in August
    const res = await post({ portionId: "p1", tenant: "Asha", moveOut: "2026-08-15" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe(
      "Rent is logged for September 2026. Choose a move-out date in September 2026 or later, or undo that payment first.",
    );
    expect(body.error.details).toEqual({ field: "moveOut" });

    const lines = loggedLines(logs.info);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "api-error", code: "validation", route: "/api/tenancies/move-out" });
    expect(JSON.stringify(lines)).not.toContain("Asha");
    expect(JSON.stringify(logs.warn.mock.calls) + JSON.stringify(logs.error.mock.calls)).not.toContain("Asha");
  });
});
