import { requireOwner } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { portionOrderBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { reorderPortions } from "@/lib/sheets/portion-service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** Puts the portions in the order given. Owner only. Answers with the portions as the Sheet now has them. */
export async function PUT(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireOwner();
    const { ids } = parseBody(raw, portionOrderBody);
    return await runWrite(viewer.email, () => reorderPortions(getSheetsContext(), { ids }));
  }, request);
}
