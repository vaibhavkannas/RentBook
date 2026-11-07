import fs from "node:fs";
import type { AppEnv } from "@/lib/server/env";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { FakeGateway } from "../../tests/support/fake-gateway";
import { faults as noFaults, withFaults, world, type Fault, type Faults } from "../../tests/support/worlds";

/**
 * The in-memory Sheet of the end-to-end run. The runner copies this file, unchanged, into a temporary copy of the app, where
 * src/lib/server/gateway-source.ts becomes the one line `export { createGateway } from "../../../scripts/e2e/sheet";`. The app
 * then builds its Sheets context (environment, named tabs, caches) as it does in production, on top of this gateway instead
 * of Google's. It is never part of the real app: nothing under src imports it, and no setting switches it on.
 *
 * Which methods fail, and how, is read from the JSON file named by E2E_CONTROL before every call, so the runner can switch a
 * fault on and off while the server runs: `{ "fail": { "getValues": "unavailable" } }` (see `Fault` in tests/support/worlds.ts).
 */

/** Where the one Sheet is kept. Each route of a build has its own copy of this module, but they share globalThis. */
export const E2E_GATEWAY_KEY = "__rentbookE2eGateway";

const KINDS: readonly Fault[] = ["unavailable", "rate-limited", "config", "error"];

/** The faults the control file asks for now: none when it is missing, unreadable or not what it should be. */
function readFaults(file: string): Faults {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  const fail = typeof parsed === "object" && parsed !== null ? (parsed as { fail?: unknown }).fail : undefined;
  if (typeof fail !== "object" || fail === null || Array.isArray(fail)) return {};
  const faults: Record<string, Fault> = {};
  for (const [method, kind] of Object.entries(fail)) {
    if (KINDS.includes(kind as Fault)) faults[method] = kind as Fault;
  }
  return faults;
}

/** This copy of the module's gateway: the shared Sheet under this copy's faults. */
let mine: { sheet: FakeGateway; control: string; gateway: SheetsGateway } | undefined;

/**
 * The gateway to the Sheet, in the shape of the real `createGateway(env)`: one `main` world as it stands today, made once per
 * server and kept on globalThis, so that every route reads and writes the same Sheet, under the faults of the control file. It
 * refuses at once when E2E_CONTROL is not set.
 *
 * Only the Sheet is shared. The faults are thrown by this copy of the module, with this copy's `AppError`: a route checks what
 * it catches with `instanceof AppError`, and an error made by another route's copy of the class would not pass, so a save that
 * ought to say "Google isn't responding" would say "Something went wrong". (Found by the end-to-end run itself.)
 */
export function createGateway(env: AppEnv): SheetsGateway {
  void env;
  const control = process.env.E2E_CONTROL?.trim();
  if (!control) throw new Error("E2E_CONTROL is not set. This Sheet is for the end-to-end run only (npm run e2e).");
  const shared = globalThis as Record<string, unknown>;
  const sheet = (shared[E2E_GATEWAY_KEY] ??= new FakeGateway(world("main", new Date()).tabs)) as FakeGateway;
  if (mine?.sheet === sheet && mine.control === control) return mine.gateway;
  // withFaults looks the method up in the faults on every call: a proxy that reads the file makes each call see the file as it is.
  const live = new Proxy(noFaults(), { get: (_target, method) => readFaults(control)[method as keyof SheetsGateway] }) as Faults;
  mine = { sheet, control, gateway: withFaults(sheet, live) };
  return mine.gateway;
}
