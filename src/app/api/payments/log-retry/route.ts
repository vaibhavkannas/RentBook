import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { logRetryBody } from "@/lib/server/schemas";
import { retryLogRow } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    await requireUser();
    const { row } = await parseJson(request, logRetryBody);
    return { logWritten: await retryLogRow(getSheetsContext(), row) };
  });
}
