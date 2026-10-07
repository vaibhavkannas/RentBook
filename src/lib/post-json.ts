/** POSTs JSON and returns the parsed answer, or null when no answer arrived (a network failure). */
export async function postJson<T>(url: string, payload: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
