import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const saveSettings = vi.hoisted(() => vi.fn(async () => []));
const logPayment = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ logWritten: boolean }>>(async () => ({ logWritten: true })),
);

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/sheets/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/service")>()),
  saveSettings,
  logPayment,
}));

import { POST as postPayment } from "@/app/api/payments/route";
import { PUT as putSettings } from "@/app/api/settings/route";

const settingsRequest = () =>
  new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      portions: [{ id: "p1", name: "Ground", cycleLength: 11, hikePercent: 5 }],
    }),
  });

const signedInAs = (email: string | null) =>
  auth.mockResolvedValue(email ? { user: { email } } : null);

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.ALLOWED_EMAILS;
  process.env.ALLOWED_EMAILS = "owner@example.com, member@example.com";
  saveSettings.mockClear();
  logPayment.mockClear();
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = savedEnv;
});

describe("PUT /api/settings", () => {
  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("rejects a signed-in address that is not on the list", async () => {
    signedInAs("stranger@example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("rejects a listed member who is not the owner", async () => {
    signedInAs("member@example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("lets the owner save", async () => {
    signedInAs("Owner@Example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(200);
    expect(saveSettings).toHaveBeenCalledOnce();
  });
});

describe("POST /api/payments", () => {
  const paymentRequest = () =>
    new Request("http://localhost/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: "2026-10",
        portionId: "p1",
        amount: 5450,
        dateReceived: "2026-10-05",
      }),
    });

  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await postPayment(paymentRequest());
    expect(res.status).toBe(401);
    expect(logPayment).not.toHaveBeenCalled();
  });

  it("records the signed-in email, lower-cased, as who logged it", async () => {
    signedInAs("Member@Example.com");
    const res = await postPayment(paymentRequest());
    expect(res.status).toBe(200);
    expect(logPayment).toHaveBeenCalledOnce();
    const options = logPayment.mock.calls[0][2] as { loggedBy: string };
    expect(options.loggedBy).toBe("member@example.com");
  });
});
