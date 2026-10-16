import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { tenancyBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { saveTenancy } from "@/lib/sheets/tenancy-service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** Creates a tenancy (no `id`) or updates one (`id` and `expectedUpdatedAt`). Everyone on the allow-list may. */
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const body = await parseJson(request, tenancyBody);
    const result = await runWrite(() =>
      saveTenancy(
        getSheetsContext(),
        {
          portionId: body.portionId,
          tenant: body.tenant,
          fields: body.fields,
          id: body.id,
          expectedUpdatedAt: body.expectedUpdatedAt,
        },
        { now: new Date(), updatedBy: viewer.email },
      ),
    );
    return { ...result };
  });
}
