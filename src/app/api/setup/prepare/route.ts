import { requireOwner } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { prepareBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { prepareSheet } from "@/lib/sheets/prepare";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** Prepare my Sheet: creates the tabs the app needs that are not there. Owner only. */
export async function POST(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireOwner();
    parseBody(raw, prepareBody);
    return await runWrite(viewer.email, () => prepareSheet(getSheetsContext()));
  }, request);
}
