import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { moveOutBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { moveOutTenancy, moveOutWithoutDetails } from "@/lib/sheets/tenancy-service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/**
 * Moves a tenant out. With the id of the details on file it records the date, what happened to the advance, the refund and
 * the deductions; with a portion and a tenant instead it records the move-out of a tenant who has no details on file.
 */
export async function POST(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireUser();
    const body = parseBody(raw, moveOutBody);
    const stamp = { now: new Date(), updatedBy: viewer.email };
    const result = await runWrite(viewer.email, () =>
      "id" in body
        ? moveOutTenancy(getSheetsContext(), body, stamp)
        : moveOutWithoutDetails(getSheetsContext(), body, stamp),
    );
    return { ...result };
  }, request);
}
