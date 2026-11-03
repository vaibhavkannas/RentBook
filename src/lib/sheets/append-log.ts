import { AppError } from "@/lib/errors";
import { errorLogFields, logEvent } from "@/lib/server/log";

/**
 * The loop that adds rows to one of the app's log tabs (the Payments Log and the Tenancy Log). It adds again ONLY after
 * Google refused for sending too many requests: that refusal means nothing was done. A timeout, a 5xx, a lost connection or
 * any other error can come back after the rows were already added, so trying again could put them in twice; those stop at once.
 * Each failed try goes to the server log (`event`, with `what` saying where and how it failed), through `errorLogFields`, and
 * never with the rows: they hold a tenant's name, amounts and a person's address.
 *
 * Returns false when the rows are not known to be there.
 */
export async function appendWithRetry(options: {
  /** One try: adds the rows, or throws. */
  append: () => Promise<void>;
  /** At most this many tries. */
  attempts: number;
  /** The wait before try n + 1 is this times n, up to `maxWaitMs`. */
  retryDelayMs: number;
  /** The longest wait between two tries, whatever delay the caller asks for. */
  maxWaitMs: number;
  /** No new try starts when the tries so far, plus the wait before it, would pass this: the request holds the write lock and must finish inside its time. */
  budgetMs: number;
  /** The log event of a failed try, in kebab-case. */
  event: string;
  /** The words of the log line for try number `attempt`: where it was and what it did not do, without any value. */
  what: (attempt: number) => string;
}): Promise<boolean> {
  const { append, attempts, retryDelayMs, maxWaitMs, budgetMs, event, what } = options;
  const started = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await append();
      return true;
    } catch (error) {
      logEvent("error", event, errorLogFields(error, what(attempt)));
      const cannotHaveLanded = error instanceof AppError && error.code === "rate-limited";
      if (!cannotHaveLanded || attempt === attempts) return false;
      const wait = Math.min(retryDelayMs * attempt, maxWaitMs);
      if (Date.now() - started + wait > budgetMs) return false;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return false;
}
