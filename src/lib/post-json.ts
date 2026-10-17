/**
 * How long a request waits for an answer before it gives up and says it could not confirm the save. The server
 * cuts a request off after 15 seconds (maxDuration), so a slow Google normally gets an answer back well before this.
 */
export const POST_TIMEOUT_MS = 30_000;

/**
 * What came of sending a request, and, when no answer came, why:
 *  - answer: the server replied with JSON (an error answer is still an answer; the caller reads its `ok`);
 *  - offline: the browser said there is no connection, so nothing was sent;
 *  - timeout: nothing came back in time, and the request was dropped. The server may still have saved it;
 *  - no-answer: the request failed some other way, or the reply was not JSON. It may have been saved.
 */
export type SendResult<T> = { kind: "answer"; body: T } | { kind: "offline" } | { kind: "timeout" } | { kind: "no-answer" };

type SendOptions = {
  /** How long to wait for the answer. */
  timeoutMs?: number;
  /** A POST unless this says PUT (the settings are saved with one). */
  method?: "POST" | "PUT";
};

/**
 * Sends JSON and says what came of it (see SendResult). A stalled request is aborted, so the form that sent it never
 * stays locked for ever. Only `answer` says what the server did: the other results do not mean the change was not made,
 * except `offline`, where nothing was sent.
 */
export async function sendJson<T>(
  url: string,
  payload: unknown,
  { timeoutMs = POST_TIMEOUT_MS, method = "POST" }: SendOptions = {},
): Promise<SendResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline" };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { kind: "answer", body: (await res.json()) as T };
  } catch {
    return timedOut ? { kind: "timeout" } : { kind: "no-answer" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends JSON and returns the parsed answer, or null when no usable answer arrived (see sendJson for the reasons). A null
 * does not mean the change was not made: callers say they could not confirm it.
 */
export async function postJson<T>(
  url: string,
  payload: unknown,
  timeoutMs = POST_TIMEOUT_MS,
  method: "POST" | "PUT" = "POST",
): Promise<T | null> {
  const result = await sendJson<T>(url, payload, { timeoutMs, method });
  return result.kind === "answer" ? result.body : null;
}
