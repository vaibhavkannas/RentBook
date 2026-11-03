import { sendJson } from "@/lib/post-json";

/**
 * What the browser does about the Tenancy Log rows of a save that did not reach the Tenancy Log. The save itself went
 * through; the server hands back a signed token for the rows (see withHistoryToken), and the browser sends it back once. The
 * person is told only when that does not work either. Browser-safe: it imports nothing of the server.
 */

/** Shown when the history could not be added, even after the one automatic retry. The change itself is safe. */
export const HISTORY_NOT_SAVED = "The change was saved, but it couldn't be added to the History.";

/** The route the token is sent to. */
const HISTORY_RETRY_URL = "/api/tenancies/history-retry";

/** How long the retry waits for an answer: the save has already been shown to the person, so the wait is not theirs to see. */
export const HISTORY_RETRY_TIMEOUT_MS = 10_000;

/** The parts of an answer of a tenancy or payment route that say what became of the history. */
export type HistoryAnswer = { historyWritten?: boolean; historyRetryToken?: string };

/**
 * True when the history is in the Tenancy Log: the answer said so (or said nothing about it, as a save that has no history
 * does), or the one retry with the answer's token got the rows in. False when it did not, and when there was no token to retry
 * with. It never rejects, and sends at most one request. `send` is `sendJson`; a test passes its own.
 */
export async function settleHistory(body: HistoryAnswer, send: typeof sendJson = sendJson): Promise<boolean> {
  if (body.historyWritten !== false) return true;
  const token = body.historyRetryToken;
  if (typeof token !== "string" || token === "") return false;
  try {
    const sent = await send<{ ok: boolean; historyWritten?: boolean }>(HISTORY_RETRY_URL, { token }, { timeoutMs: HISTORY_RETRY_TIMEOUT_MS });
    return sent.kind === "answer" && sent.body.ok === true && sent.body.historyWritten === true;
  } catch {
    return false;
  }
}
