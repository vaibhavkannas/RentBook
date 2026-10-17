import "server-only";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { NamedTabsGateway } from "@/lib/sheets/named-tabs";
import { withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { readEnv } from "./env";

let cached: SheetsContext | undefined;

/** The shared Sheets context for this server instance. */
export function getSheetsContext(): SheetsContext {
  if (!cached) {
    const env = readEnv(process.env);
    cached = withSnapshotCache({
      // The app calls its tabs by fixed names; the wrapper finds the real ones (see named-tabs.ts).
      gateway: new NamedTabsGateway(GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId), {
        schedule: env.scheduleTab,
        settings: env.settingsTab,
        log: env.logTab,
        tenants: env.tenantsTab,
      }),
      scheduleTab: env.scheduleTab,
      totalHeader: env.totalHeader,
    });
  }
  return cached;
}
