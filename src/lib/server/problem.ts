import "server-only";
import { withMonth } from "@/lib/app-nav";
import { AppError, messageFor } from "@/lib/errors";
import type { Viewer } from "./auth-guard";
import { errorLogFields, logEvent } from "./log";

const WHAT = "A page could not read the Sheet";

/**
 * What a page tells `viewer` when reading the Sheet failed. Everyone is told what they can act on: that Google
 * is limiting requests or not responding, or what is wrong with the Sheet's own structure. A problem with the
 * connection itself (the key, the sharing, SHEET_ID) is for the owner: anyone else is told to ask them. The
 * full text of those, and of any failure that is not ours to explain, goes to the server log as one line (see
 * log.ts). The line has no request id: this function is given the error and the viewer, not the request.
 */
export function problemMessage(error: unknown, viewer: Viewer): string {
  if (error instanceof AppError) {
    if (error.code === "config") logEvent("error", "sheet-connection-problem", errorLogFields(error, WHAT));
    return messageFor(error, viewer.isOwner);
  }
  logEvent("error", "page-load-failed", errorLogFields(error, WHAT));
  return "Couldn't reach Google Sheets. Try again.";
}

/**
 * Where a page that could not read the Sheet sends the owner to see what is wrong: Set up, kept in the month the person was
 * looking at (`monthKey`). Only for the owner, who is the only one who can open it, and only for a problem Set up can
 * explain: the connection (config) or the Sheet's own structure. Google being busy or down, a screen that is out of date and
 * a failure that is not ours are not for Set up. Logs nothing: `problemMessage` has said what there is to say.
 */
export function setupHrefFor(error: unknown, viewer: Viewer, monthKey?: string | null): string | undefined {
  if (!viewer.isOwner || !(error instanceof AppError)) return undefined;
  return error.code === "config" || error.code === "sheet-structure" ? withMonth("/setup", monthKey) : undefined;
}
