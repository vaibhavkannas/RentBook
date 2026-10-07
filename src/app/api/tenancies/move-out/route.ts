import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { moveOutBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { moveOutTenancy } from "@/lib/sheets/tenancy-service";

/** Moves a tenant out: records the date, what happened to the advance, the refund and the deductions. */
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const body = await parseJson(request, moveOutBody);
    const result = await runWrite(() =>
      moveOutTenancy(getSheetsContext(), body, { now: new Date(), updatedBy: viewer.email }),
    );
    return { ...result };
  });
}
