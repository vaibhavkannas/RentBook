import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetsContext } from "@/lib/sheets/service";
import { SETTINGS_TAB } from "@/lib/sheets/settings-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, settingsGrid, settingsGridWithActive, TOTAL_HEADER } from "../support/fixtures";
import { captureLogs, loggedLines, type LogSpies } from "../support/logs";

// A refusal is logged by the route as one line, at info, with the text of the error. What the owner typed into a cell of the
// Settings tab must never be in it: the refusal names the cell (H3), not what it holds.

const state = vi.hoisted(() => ({ ctx: null as unknown }));
const auth = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => state.ctx }));
vi.mock("@/lib/server/freshness", () => ({ markWritten: vi.fn(async () => undefined), readWrittenAt: vi.fn(async () => undefined) }));

import { PUT } from "@/app/api/portions/active/route";

const SECRET = "secret-note-from-the-owner-xyz";

let logs: LogSpies;
beforeEach(() => {
  logs = captureLogs();
  process.env.ALLOWED_EMAILS = "owner@example.com";
  vi.stubEnv("AUTH_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
  vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
  auth.mockResolvedValue({ user: { email: "owner@example.com" } });
});
afterEach(() => {
  for (const spy of Object.values(logs)) spy.mockRestore();
  vi.unstubAllEnvs();
  delete process.env.ALLOWED_EMAILS;
});

function withSheet(settings: unknown[][]) {
  const fake = new FakeGateway({ Schedule: baseSchedule(), [SETTINGS_TAB]: settings });
  state.ctx = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } satisfies SheetsContext;
  return fake;
}

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/portions/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

async function expectRefusedWithoutTheText(settings: unknown[][], message: string) {
  withSheet(settings);
  const res = await put({ id: "p4", active: false });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.message).toBe(message);
  expect(JSON.stringify(body)).not.toContain(SECRET);

  const lines = loggedLines(logs.info);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ event: "api-error", code: "validation", route: "/api/portions/active" });
  const everything = JSON.stringify(logs.info.mock.calls) + JSON.stringify(logs.warn.mock.calls) + JSON.stringify(logs.error.mock.calls);
  expect(everything).not.toContain(SECRET);
}

describe("a switch refused because of what is in column H of the Settings tab", () => {
  it("names the cell and not what an Active cell holds, in the answer and in the log", async () => {
    await expectRefusedWithoutTheText(
      settingsGridWithActive({ p2: SECRET }),
      "Cell H3 of the Settings tab is not Yes or No. Type Yes or No in that cell, then try again.",
    );
  });

  it("names H1 and not what it holds", async () => {
    const grid = settingsGrid();
    grid[0][7] = SECRET;
    await expectRefusedWithoutTheText(
      grid,
      "Cell H1 of the Settings tab holds other text. RentBook keeps the Active setting in column H: move that column further right, then try again.",
    );
  });

  it("names the cell and not what the owner's own column holds under a blank H1", async () => {
    const grid = settingsGrid();
    grid[2][7] = SECRET;
    await expectRefusedWithoutTheText(
      grid,
      "Cell H3 of the Settings tab already holds something. RentBook keeps the Active setting in column H: move that column further right, then try again.",
    );
  });

  it("still switches a portion off through the route when column H is the app's", async () => {
    const fake = withSheet(settingsGridWithActive());
    const res = await put({ id: "p4", active: false });
    expect(res.status).toBe(200);
    expect(fake.tabs.get(SETTINGS_TAB)![4][7]).toBe("No");
  });
});
