import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { readRetryToken } from "@/lib/server/retry-token";
import { logRetryBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { retryLogRow, type LogRow } from "@/lib/sheets/service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const { token } = await parseJson(request, logRetryBody);
    // The row comes from the token the server signed for this person, never from the request.
    const row = readRetryToken(token, viewer.email);
    // "Logged by" is always the signed-in person, whatever the row says, so nobody can forge it.
    const stamped: LogRow = [row[0], row[1], row[2], row[3], row[4], row[5], row[6], viewer.email, row[8]];
    // The Activity screen is kept for a short time, so this person's next view must not be answered from it.
    return { logWritten: await runWrite(viewer.email, () => retryLogRow(getSheetsContext(), stamped)) };
  });
}
