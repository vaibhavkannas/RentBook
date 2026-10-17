import { afterEach, describe, expect, it, vi } from "vitest";
import { POST_TIMEOUT_MS, postJson, sendJson } from "@/lib/post-json";

// sendJson says why no answer came: nothing was sent (offline), the wait ran out (timeout), or the answer never arrived
// (no-answer). postJson, which only says "no answer", is built on it.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answer = (body: unknown, status = 200) => ({ status, json: async () => body }) as unknown as Response;

/** A fetch that never answers, and rejects with an AbortError when its request is aborted, as a real one does. */
function stalledFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      }),
  );
}

describe("sendJson: an answer", () => {
  it("posts the payload as JSON and returns the parsed answer as { kind: answer }", async () => {
    const fetchMock = vi.fn(async () => answer({ ok: true, value: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendJson("/api/tenancies", { a: 1 })).resolves.toEqual({ kind: "answer", body: { ok: true, value: 7 } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tenancies");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the method it is given in place of POST", async () => {
    const fetchMock = vi.fn(async () => answer({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/settings", { portions: [] }, { method: "PUT" });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("PUT");
  });

  it("counts a refusal that came as JSON (a 400, a 409, a 500) as an answer: the server said something", async () => {
    for (const status of [400, 401, 409, 500]) {
      vi.stubGlobal("fetch", vi.fn(async () => answer({ ok: false, error: { code: "validation", message: "No." } }, status)));
      await expect(sendJson("/x", {})).resolves.toEqual({
        kind: "answer",
        body: { ok: false, error: { code: "validation", message: "No." } },
      });
    }
  });

  it("is online when the browser does not say (no navigator.onLine), and when it says true", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ok: true })));
    vi.stubGlobal("navigator", {});
    expect((await sendJson("/x", {})).kind).toBe("answer");
    vi.stubGlobal("navigator", { onLine: true });
    expect((await sendJson("/x", {})).kind).toBe("answer");
  });
});

describe("sendJson: offline", () => {
  it("sends nothing and says offline when the browser reports no connection", async () => {
    const fetchMock = vi.fn(async () => answer({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });

    await expect(sendJson("/x", {})).resolves.toEqual({ kind: "offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts no timer when it sends nothing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("navigator", { onLine: false });
    await sendJson("/x", {});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("sendJson: a timeout", () => {
  it("says timeout after about 30 seconds, and aborts the request", async () => {
    vi.useFakeTimers();
    const fetchMock = stalledFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(POST_TIMEOUT_MS).toBe(30_000);

    let settled = false;
    const pending = sendJson("/x", {}).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: "timeout" });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours a different timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stalledFetch());
    const pending = sendJson("/x", {}, { timeoutMs: 500, method: "PUT" });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ kind: "timeout" });
  });

  it("says timeout, not no-answer, when the wait runs out while the answer is being read", async () => {
    vi.useFakeTimers();
    const slowBody = {
      json: () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new DOMException("aborted", "AbortError")), 600);
        }),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => slowBody));
    const pending = sendJson("/x", {}, { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(600);
    // the timer fired at 500 and the body was cut off at 600: the wait ran out
    expect(await pending).toEqual({ kind: "timeout" });
  });
});

describe("sendJson: no answer", () => {
  it("says no-answer when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(sendJson("/x", {})).resolves.toEqual({ kind: "no-answer" });
  });

  it("says no-answer when the answer is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => Promise.reject(new SyntaxError("Unexpected token <")) }) as unknown as Response));
    await expect(sendJson("/x", {})).resolves.toEqual({ kind: "no-answer" });
  });

  it("stops the timer after an answer and after a failure, so nothing is aborted later", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ok: true })));
    await sendJson("/x", {});
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await sendJson("/x", {});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("postJson, now a thin wrapper", () => {
  it("returns the body of an answer and null for everything else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({ ok: true, value: 1 })));
    await expect(postJson("/x", {})).resolves.toEqual({ ok: true, value: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(postJson("/x", {})).resolves.toBeNull();
  });

  it("returns null without sending anything when the browser is offline", async () => {
    const fetchMock = vi.fn(async () => answer({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });
    await expect(postJson("/x", {})).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
