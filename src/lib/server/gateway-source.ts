import "server-only";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import type { AppEnv } from "./env";

/**
 * The one place the app makes the gateway to the owner's Sheet: the Google gateway for the environment's service account and
 * Sheet. context.ts wraps it (named tabs, caches), so a copy of the app that is to talk to an in-memory Sheet replaces this
 * module alone and keeps everything else as it runs in production.
 */
export function createGateway(env: AppEnv): SheetsGateway {
  return GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId);
}
