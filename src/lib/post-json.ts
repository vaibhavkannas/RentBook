/**
 * How long a request waits for an answer before it gives up and says it could not confirm the save. The server
 * cuts a request off after 15 seconds (maxDuration), so a slow Google normally gets an answer back well before this.
 */
export const POST_TIMEOUT_MS = 30_000;

/**
 * Sends JSON and returns the parsed answer, or null when no usable answer arrived: a network failure, a
 * reply that is not JSON, or no reply within `timeoutMs`. It is a POST unless `method` says PUT (the settings are
 * saved with one). A stalled request is aborted, so the form that sent it never stays locked for ever. A null
 * does not mean the change was not made: callers say they could not confirm it.
 */
export async function postJson<T>(
  url: string,
  payload: unknown,
  timeoutMs = POST_TIMEOUT_MS,
  method: "POST" | "PUT" = "POST",
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
