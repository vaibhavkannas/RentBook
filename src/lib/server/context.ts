import "server-only";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import { withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { readEnv, type AppEnv } from "./env";

/**
 * The gateway to the owner's Sheet for an environment: the Google gateway, wrapped so that the app keeps calling its
 * tabs by one fixed name each while the Sheet may spell them differently or call the app's own tabs something else (see
 * named-tabs.ts). The scripts use it too, so they find the tabs the way the app does. `sheetId` is the Sheet to talk
 * to, when it is not the one in `env` (a test copy).
 */
export function sheetsGatewayFor(env: AppEnv, sheetId: string = env.sheetId): SheetsGateway {
  return new NamedTabsGateway(GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, sheetId), {
    schedule: env.scheduleTab,
    settings: env.settingsTab,
    log: env.logTab,
    tenants: env.tenantsTab,
  });
}

let cached: SheetsContext | undefined;

/** The shared Sheets context for this server instance. */
export function getSheetsContext(): SheetsContext {
  if (!cached) {
    const env = readEnv(process.env);
    cached = withSnapshotCache({
      gateway: sheetsGatewayFor(env),
      scheduleTab: env.scheduleTab,
      totalHeader: env.totalHeader,
    });
  }
  return cached;
}
