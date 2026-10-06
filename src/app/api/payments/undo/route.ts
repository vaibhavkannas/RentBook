import { parseYmKey } from "@/lib/domain/year-month";
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { undoBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { undoPayment } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const body = await parseJson(request, undoBody);
    const result = await runWrite(() =>
      undoPayment(
        getSheetsContext(),
        { month: parseYmKey(body.month)!, portionId: body.portionId, expected: body.expected },
        { now: new Date(), loggedBy: viewer.email },
      ),
    );
    return { ...result };
  });
}
