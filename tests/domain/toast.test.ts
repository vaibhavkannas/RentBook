import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToastStore, TOAST_MS, type ToastState } from "@/lib/toast";

// How long a toast stays and what a second one does: a toast lasts 4 seconds, and a new one, even with the same text,
// is a new toast with its own full time.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function store() {
  const seen: ToastState[] = [];
  const toasts = createToastStore((toast) => seen.push(toast));
  return { toasts, seen, last: () => seen[seen.length - 1] };
}

describe("a toast", () => {
  it("lasts four seconds", () => {
    expect(TOAST_MS).toBe(4000);
  });

  it("shows its text with an id, and goes after four seconds", () => {
    const { toasts, seen, last } = store();
    toasts.show("Settings saved");
    expect(last()).toEqual({ id: 1, text: "Settings saved" });
    vi.advanceTimersByTime(3999);
    expect(last()).toEqual({ id: 1, text: "Settings saved" });
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
    expect(seen).toHaveLength(2);
  });

  it("is replaced by the next one, which has its own four seconds", () => {
    const { toasts, last } = store();
    toasts.show("First");
    vi.advanceTimersByTime(3000);
    toasts.show("Second");
    expect(last()).toEqual({ id: 2, text: "Second" });
    vi.advanceTimersByTime(3999);
    expect(last()).toEqual({ id: 2, text: "Second" });
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
  });

  it("is a new toast even when its text is the same, so it shows again from the start", () => {
    const { toasts, seen } = store();
    toasts.show("Details saved");
    vi.advanceTimersByTime(2000);
    toasts.show("Details saved");
    const ids = seen.filter((toast): toast is NonNullable<ToastState> => toast !== null).map((toast) => toast.id);
    expect(ids).toEqual([1, 2]);
    vi.advanceTimersByTime(3999);
    expect(seen[seen.length - 1]).toEqual({ id: 2, text: "Details saved" });
  });

  it("does not take the second toast away with the first one's timer", () => {
    const { toasts, seen } = store();
    toasts.show("First");
    vi.advanceTimersByTime(3500);
    toasts.show("Second");
    vi.advanceTimersByTime(600);
    // the first timer would have fired by now, and the second toast must still be showing
    expect(seen.filter((toast) => toast === null)).toHaveLength(0);
  });

  it("is not taken away after the store is disposed of", () => {
    const { toasts, seen } = store();
    toasts.show("Settings saved");
    toasts.dispose();
    vi.advanceTimersByTime(10_000);
    expect(seen).toHaveLength(1);
  });

  it("can be shown again after it has gone, with the next id", () => {
    const { toasts, last } = store();
    toasts.show("One");
    vi.advanceTimersByTime(4000);
    toasts.show("Two");
    expect(last()).toEqual({ id: 2, text: "Two" });
  });
});
