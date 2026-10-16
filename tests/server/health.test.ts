import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";

// The health check is open on purpose (see guards.test.ts): an uptime monitor has no session. It must work with
// no sign-in settings at all, and must say nothing about the app beyond that it is up and which version it is.
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

import { GET } from "@/app/api/health/route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("answers exactly { ok: true, version }, with the version from package.json and nothing else", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await res.json();
    expect(body).toEqual({ ok: true, version: pkg.version });
    expect(Object.keys(body)).toEqual(["ok", "version"]);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("answers a visitor who is not signed in, and never asks who is", async () => {
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
  });

  it("answers when no sign-in setting or Sheet setting exists", async () => {
    for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "ALLOWED_EMAILS", "SHEET_ID"]) {
      vi.stubEnv(name, "");
    }
    expect(await (await GET()).json()).toEqual({ ok: true, version: pkg.version });
  });

  it("does not leak the rest of package.json: no dependency list, no name", async () => {
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain("next");
    expect(text).not.toContain("rentbook");
  });
});
