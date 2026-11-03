import type { TenancyLogRow } from "@/lib/domain/tenancy-log";
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { readHistoryRetryToken } from "@/lib/server/retry-token";
import { historyRetryBody } from "@/lib/server/schemas";
import { runWrite } from "@/lib/server/writes";
import { retryTenancyHistory } from "@/lib/sheets/tenancy-service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/**
 * Adds the Tenancy Log rows of a save whose history did not reach the Tenancy Log, from the signed token the save gave back.
 * Everyone on the allow-list may (the token is the proof). Safe to send again: the rows are added only once.
 */
export async function POST(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireUser();
    const { token } = parseBody(raw, historyRetryBody);
    // The rows come from the token the server signed for this person, never from the request.
    const rows = readHistoryRetryToken(token, viewer.email);
    // "Changed by" is always the signed-in person, whatever the row says, so nobody can forge it.
    const stamped = rows.map((row): TenancyLogRow => [row[0], row[1], row[2], row[3], row[4], row[5], row[6], viewer.email]);
    // The pages are kept for a short time, so this person's next view must not be answered from it.
    return { historyWritten: await runWrite(viewer.email, () => retryTenancyHistory(getSheetsContext(), stamped)) };
  }, request);
}
