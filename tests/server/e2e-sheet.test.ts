import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { readEnv } from "@/lib/server/env";
import { createGateway as realCreateGateway } from "@/lib/server/gateway-source";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { createGateway, E2E_GATEWAY_KEY } from "../../scripts/e2e/sheet";
import { FIXED_NOW, TEST_ENV } from "../support/screens";
import { withoutComments } from "../support/source-scan";

// scripts/e2e/sheet.ts goes into the end-to-end run's temporary copy, where src/lib/server/gateway-source.ts becomes one line that
// re-exports its createGateway: the whole app then talks to an in-memory Sheet, and everything else (the environment, the named
// tabs, the caches) runs as in production.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const env = readEnv(TEST_ENV);
const shared = globalThis as Record<string, unknown>;

let dir: string;
let control: string;

/** Says which methods of the gateway fail, and how, the way the runner does. */
const fail = (faults: Record<string, string>) => fs.writeFileSync(control, JSON.stringify({ fail: faults }));

beforeEach(() => {
  // The world is made for the day it is first asked for, so the day is fixed (the way the screen tests fix it: Date only, so
  // promises and timers run as usual) and a test that runs over a month's end in India cannot find another month's world.
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rentbook-e2e-sheet-"));
  control = path.join(dir, "control.json");
  vi.stubEnv("E2E_CONTROL", control);
  delete shared[E2E_GATEWAY_KEY];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete shared[E2E_GATEWAY_KEY];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createGateway", () => {
  it("has the parameter count of the real one, so the one-line re-export is a drop-in", () => {
    expect(createGateway.length).toBe(realCreateGateway.length);
    expect(createGateway.length).toBe(1);
  });

  it("refuses at once when E2E_CONTROL is not set, so a copy that was not meant to run cannot fake a Sheet", () => {
    vi.stubEnv("E2E_CONTROL", undefined);
    expect(() => createGateway(env)).toThrow(/E2E_CONTROL/);
    vi.stubEnv("E2E_CONTROL", "  ");
    expect(() => createGateway(env)).toThrow(/E2E_CONTROL/);
  });

  it("makes one gateway for the server, and keeps the Sheet on globalThis, so every route reads and writes the same Sheet", async () => {
    const first = createGateway(env);
    expect(createGateway(env)).toBe(first);
    expect(shared[E2E_GATEWAY_KEY]).toBeDefined();
    // a second route's bundle has its own copy of the module: it finds the first one's Sheet
    vi.resetModules();
    const other = await import("../../scripts/e2e/sheet");
    await first.updateValues([{ tab: "Settings", a1: "B2", values: [["Changed by the first bundle"]] }]);
    expect((await other.createGateway(env).getValues("Settings", "B2", "UNFORMATTED_VALUE"))[0][0]).toBe("Changed by the first bundle");
  });

  it("throws its faults with the AppError of its own copy of the module, which is the class the route that catches them knows", async () => {
    // A route says "Google isn't responding" only for an error that is an instance of its own AppError (src/lib/server/http.ts).
    vi.resetModules();
    const { AppError: ownClass } = await import("@/lib/errors");
    const other = await import("../../scripts/e2e/sheet");
    fail({ getValues: "unavailable" });
    const failure = await other.createGateway(env).getValues("Settings", "A1", "FORMATTED_VALUE").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ownClass);
    expect(failure).not.toBeInstanceOf(AppError);
  });

  it("holds the main world as it stands on the day it is made: the five app tabs, and a row for that month", async () => {
    const gateway = createGateway(env);
    expect((await gateway.listTabs()).sort()).toEqual(["Payments Log", "Schedule", "Settings", "Tenancy Log", "Tenants"]);
    const months = (await gateway.getValues("Schedule", "A4:A", "FORMATTED_VALUE")).map((row) => String(row[0]));
    // 17 October 2026: the month's row is the last, with the two before it
    expect(months).toEqual(["Aug-26", "Sep-26", "Oct-26"]);
  });

  it("is made for the day in India time, whatever the day is in UTC", async () => {
    // 20:00 UTC on 31 October is 01:30 on 1 November in India
    vi.setSystemTime(new Date("2026-10-31T20:00:00Z"));
    const months = (await createGateway(env).getValues("Schedule", "A4:A", "FORMATTED_VALUE")).map((row) => String(row[0]));
    expect(months).toEqual(["Sep-26", "Oct-26", "Nov-26"]);
  });
});

describe("faults from the control file", () => {
  const read = (gateway: SheetsGateway) => gateway.getValues("Settings", "A1:A2", "FORMATTED_VALUE");

  it("make a method fail the way Google does: unavailable, rate-limited, a wrong setting, or a plain error", async () => {
    const gateway = createGateway(env);
    fail({ getValues: "unavailable" });
    await expect(read(gateway)).rejects.toMatchObject({ code: "unavailable", message: "Google isn't responding. Try again in a minute." });
    fail({ getValues: "rate-limited" });
    await expect(read(gateway)).rejects.toMatchObject({ code: "rate-limited", message: "Google is limiting requests right now. Wait a minute and try again." });
    fail({ getValues: "config" });
    await expect(read(gateway)).rejects.toMatchObject({ code: "config", message: "Google could not find that Sheet. Check SHEET_ID." });
    fail({ getValues: "error" });
    const plain = await read(gateway).catch((error: unknown) => error);
    expect(plain).toBeInstanceOf(Error);
    expect(plain).not.toBeInstanceOf(AppError);
  });

  it("are read before each call: switched on after the gateway exists, and off again, with no restart", async () => {
    const gateway = createGateway(env);
    await expect(read(gateway)).resolves.toBeDefined();
    fail({ getValues: "unavailable" });
    await expect(read(gateway)).rejects.toMatchObject({ code: "unavailable" });
    await expect(read(gateway)).rejects.toMatchObject({ code: "unavailable" });
    fail({});
    await expect(read(gateway)).resolves.toBeDefined();
    fail({ getValues: "unavailable" });
    fs.rmSync(control);
    await expect(read(gateway)).resolves.toBeDefined();
  });

  it("fail only the methods the file names", async () => {
    const gateway = createGateway(env);
    fail({ updateValues: "unavailable" });
    await expect(read(gateway)).resolves.toBeDefined();
    await expect(gateway.listTabs()).resolves.toBeDefined();
    await expect(gateway.updateValues([{ tab: "Settings", a1: "B2", values: [["x"]] }])).rejects.toMatchObject({ code: "unavailable" });
    // the failed write changed nothing
    expect((await gateway.getValues("Settings", "B2", "UNFORMATTED_VALUE"))[0][0]).not.toBe("x");
  });

  it("are none when the file is missing, empty, not JSON, or says nothing useful", async () => {
    const gateway = createGateway(env);
    await expect(read(gateway)).resolves.toBeDefined();
    for (const content of ["", "{not json", "null", "[]", '{"fail":null}', '{"fail":[]}', '{"fail":{"getValues":"burning"}}', '{"fail":{"getValues":7}}']) {
      fs.writeFileSync(control, content);
      await expect(read(gateway), content).resolves.toBeDefined();
    }
  });

  it("reach every method of the gateway", async () => {
    const gateway = createGateway(env);
    const methods: Array<keyof SheetsGateway> = ["listTabs", "addTab", "getValues", "getManyValues", "updateValues", "appendRow", "appendRows", "ensureColumnCount", "cloneRow"];
    for (const method of methods) {
      fail({ [method]: "unavailable" });
      const call = (gateway[method] as unknown as (...args: unknown[]) => Promise<unknown>).bind(gateway);
      await expect(call("Settings", "A1", "FORMATTED_VALUE"), method).rejects.toMatchObject({ code: "unavailable" });
    }
  });
});

describe("what goes into the copy", () => {
  const source = withoutComments(fs.readFileSync(path.join(ROOT, "scripts", "e2e", "sheet.ts"), "utf8"));
  const imports = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]);

  it("imports only from src (as @/), from tests/support and from packages, since nothing else is copied with it", () => {
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) {
      if (name.startsWith("@/") || !name.startsWith(".")) continue;
      const target = path.normalize(path.join("scripts/e2e", name));
      expect(target.startsWith(path.join("tests", "support")), `${name} leaves the copy`).toBe(true);
      expect(fs.existsSync(path.join(ROOT, `${target}.ts`)), name).toBe(true);
    }
  });

  it("imports no Playwright and nothing of the runner", () => {
    for (const name of imports) {
      expect(name).not.toMatch(/playwright|helpers|run|checks/);
    }
  });
});
