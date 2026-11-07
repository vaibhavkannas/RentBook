import "server-only";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import { withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { readEnv, type AppEnv } from "./env";
import { createGateway } from "./gateway-source";

/** `gateway` under the app's own tab names: the app keeps calling its tabs by one fixed name each while the Sheet may spell them differently (see named-tabs.ts). */
function withTabNames(env: AppEnv, gateway: SheetsGateway): SheetsGateway {
  return new NamedTabsGateway(gateway, {
    schedule: env.scheduleTab,
    settings: env.settingsTab,
    log: env.logTab,
    tenants: env.tenantsTab,
    "tenancy-log": env.tenancyLogTab,
  });
}

/**
 * The gateway to the owner's Sheet for an environment: the Google gateway, wrapped so that the app keeps calling its
 * tabs by one fixed name each while the Sheet may spell them differently or call the app's own tabs something else (see
 * named-tabs.ts). The scripts use it too, so they find the tabs the way the app does. `sheetId` is the Sheet to talk
 * to, when it is not the one in `env` (a test copy).
 */
export function sheetsGatewayFor(env: AppEnv, sheetId: string = env.sheetId): SheetsGateway {
  return withTabNames(env, createGateway({ ...env, sheetId }));
}

/**
 * The Sheets context for an environment and the gateway to its Sheet (what `createGateway` makes): the gateway under the
 * app's tab names, with the page-view caches, the total header and the tab names of the environment. Every context is its own;
 * `getSheetsContext` keeps the one the server uses.
 */
export function buildSheetsContext(env: AppEnv, gateway: SheetsGateway): SheetsContext {
  return withSnapshotCache({
    gateway: withTabNames(env, gateway),
    scheduleTab: env.scheduleTab,
    totalHeader: env.totalHeader,
  });
}

let cached: SheetsContext | undefined;

/** The shared Sheets context for this server instance. */
export function getSheetsContext(): SheetsContext {
  if (!cached) {
    const env = readEnv(process.env);
    cached = buildSheetsContext(env, createGateway(env));
  }
  return cached;
}
