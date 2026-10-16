import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { moveOutBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { moveOutTenancy } from "@/lib/sheets/tenancy-service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** Moves a tenant out: records the date, what happened to the advance, the refund and the deductions. */
export async function POST(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireUser();
    const body = parseBody(raw, moveOutBody);
    const result = await runWrite(viewer.email, () =>
      moveOutTenancy(getSheetsContext(), body, { now: new Date(), updatedBy: viewer.email }),
    );
    return { ...result };
  }, request);
}
