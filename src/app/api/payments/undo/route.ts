import { parseYmKey } from "@/lib/domain/year-month";
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { markWritten } from "@/lib/server/freshness";
import { handle, parseJson } from "@/lib/server/http";
import { undoBody } from "@/lib/server/schemas";
import { undoPayment } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const body = await parseJson(request, undoBody);
    const result = await undoPayment(
      getSheetsContext(),
      { month: parseYmKey(body.month)!, portionId: body.portionId, expected: body.expected },
      { now: new Date(), loggedBy: viewer.email },
    );
    await markWritten();
    return { ...result };
  });
}
