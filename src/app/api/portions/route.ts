import { requireOwner } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { addPortionBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { addPortion } from "@/lib/sheets/portion-service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** Adds a portion: its three columns at the right of the Schedule and a row in the Settings tab. Owner only. */
export async function POST(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireOwner();
    const body = parseBody(raw, addPortionBody);
    const result = await runWrite(viewer.email, () => addPortion(getSheetsContext(), body));
    return { ...result };
  }, request);
}
