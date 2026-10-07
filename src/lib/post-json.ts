/** How long a form waits for an answer before it gives up and says it could not confirm the save. */
export const POST_TIMEOUT_MS = 30_000;

/**
 * POSTs JSON and returns the parsed answer, or null when no usable answer arrived: a network failure, a
 * reply that is not JSON, or no reply within `timeoutMs`. A stalled request is aborted, so a form never stays
 * locked for ever. A null does not mean the change was not made: callers say they could not confirm it.
 */
export async function postJson<T>(url: string, payload: unknown, timeoutMs = POST_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
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
