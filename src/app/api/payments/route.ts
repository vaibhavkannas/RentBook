import { parseYmKey } from "@/lib/domain/year-month";
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { withRetryToken } from "@/lib/server/retry-token";
import { paymentBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { logPayment } from "@/lib/sheets/service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

export async function POST(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireUser();
    const body = parseBody(raw, paymentBody);
    const result = await runWrite(viewer.email, () =>
      logPayment(
        getSheetsContext(),
        {
          month: parseYmKey(body.month)!,
          portionId: body.portionId,
          amount: body.amount,
          dateReceived: body.dateReceived,
          newTenantName: body.newTenantName,
          overwrite: body.overwrite,
          expected: body.expected,
          tenancy: body.tenancy,
        },
        { now: new Date(), loggedBy: viewer.email },
      ),
    );
    // The raw Payments Log row stays here: the browser gets a signed retry token when the entry did not save.
    return withRetryToken(result, viewer.email);
  }, request);
}
