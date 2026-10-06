import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import type { SheetsContext } from "@/lib/sheets/service";
import { readEnv } from "./env";

let cached: SheetsContext | undefined;

/** The shared Sheets context for this server instance. */
export function getSheetsContext(): SheetsContext {
  if (!cached) {
    const env = readEnv(process.env);
    cached = {
      gateway: GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId),
      scheduleTab: env.scheduleTab,
      totalHeader: env.totalHeader,
    };
  }
  return cached;
}
