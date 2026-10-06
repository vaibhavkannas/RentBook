import { parseYmKey } from "@/lib/domain/year-month";
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { paymentBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { logPayment } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const body = await parseJson(request, paymentBody);
    const result = await runWrite(() =>
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
        },
        { now: new Date(), loggedBy: viewer.email },
      ),
    );
    return { ...result };
  });
}
