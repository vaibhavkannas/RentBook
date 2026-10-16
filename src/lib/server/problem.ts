import "server-only";
import { AppError, messageFor } from "@/lib/errors";
import type { Viewer } from "./auth-guard";

/**
 * What a page tells `viewer` when reading the Sheet failed. Everyone is told what they can act on: that Google
 * is limiting requests or not responding, or what is wrong with the Sheet's own structure. A problem with the
 * connection itself (the key, the sharing, SHEET_ID) is for the owner: anyone else is told to ask them. The
 * full text of those, and of any failure that is not ours to explain, goes to the server log.
 */
export function problemMessage(error: unknown, viewer: Viewer): string {
  if (error instanceof AppError) {
    if (error.code === "config") console.error("Sheet connection problem:", error.message);
    return messageFor(error, viewer.isOwner);
  }
  console.error(error);
  return "Couldn't reach Google Sheets. Try again.";
}
