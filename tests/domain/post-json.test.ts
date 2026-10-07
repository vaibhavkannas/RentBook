import { afterEach, describe, expect, it, vi } from "vitest";
import { POST_TIMEOUT_MS, postJson } from "@/lib/post-json";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answer = (body: unknown) => ({ json: async () => body }) as unknown as Response;

/** A fetch that never answers, and rejects with an AbortError when its request is aborted, as a real one does. */
function stalledFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      }),
  );
}

describe("postJson", () => {
  it("posts the payload as JSON and returns the parsed answer", async () => {
    const fetchMock = vi.fn(async () => answer({ ok: true, value: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postJson("/api/tenancies", { a: 1 })).resolves.toEqual({ ok: true, value: 7 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tenancies");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(postJson("/x", {})).resolves.toBeNull();
  });

  it("returns null when the answer is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => Promise.reject(new SyntaxError("Unexpected token <")) }) as unknown as Response));
    await expect(postJson("/x", {})).resolves.toBeNull();
  });

  it("gives up after about 30 seconds, aborts the request and returns null", async () => {
    vi.useFakeTimers();
    const fetchMock = stalledFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(POST_TIMEOUT_MS).toBe(30_000);

    let settled = false;
    const pending = postJson("/x", {}).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(signal.aborted).toBe(true);
  });

  it("honours a different timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stalledFetch());
    const pending = postJson("/x", {}, 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBeNull();
  });

  it("stops the timer once the answer has arrived, so nothing is aborted later", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => answer({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postJson("/x", {})).resolves.toEqual({ ok: true });

    expect(vi.getTimerCount()).toBe(0);
    const signal = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS * 2);
    expect(signal.aborted).toBe(false);
  });

  it("stops the timer after a failure too", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await postJson("/x", {});
    expect(vi.getTimerCount()).toBe(0);
  });
});
