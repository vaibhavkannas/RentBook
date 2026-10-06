import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { logRetryBody } from "@/lib/server/schemas";
import { retryLogRow, type LogRow } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const { row } = await parseJson(request, logRetryBody);
    // "Logged by" is always the signed-in person, whatever the request says, so nobody can forge it.
    const stamped: LogRow = [row[0], row[1], row[2], row[3], row[4], row[5], row[6], viewer.email, row[8]];
    return { logWritten: await retryLogRow(getSheetsContext(), stamped) };
  });
}
