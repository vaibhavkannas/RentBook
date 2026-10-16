import { describe, expect, it } from "vitest";
import { withWriteLock } from "@/lib/sheets/write-lock";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("withWriteLock", () => {
  it("returns what the function returns", async () => {
    expect(await withWriteLock(async () => 42)).toBe(42);
  });

  it("runs one function at a time", async () => {
    let running = 0;
    let most = 0;
    const task = async () => {
      running++;
      most = Math.max(most, running);
      await sleep(5);
      running--;
    };
    await Promise.all([1, 2, 3, 4].map(() => withWriteLock(task)));
    expect(most).toBe(1);
  });

  it("runs the functions in the order they were asked for, even when an earlier one is slower", async () => {
    const order: string[] = [];
    await Promise.all([
      withWriteLock(async () => {
        await sleep(20);
        order.push("first");
      }),
      withWriteLock(async () => {
        order.push("second");
      }),
      withWriteLock(async () => {
        await sleep(5);
        order.push("third");
      }),
    ]);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("does not start a function before the one ahead of it has finished", async () => {
    const events: string[] = [];
    const first = withWriteLock(async () => {
      events.push("first starts");
      await sleep(15);
      events.push("first ends");
    });
    const second = withWriteLock(async () => {
      events.push("second starts");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["first starts", "first ends", "second starts"]);
  });

  it("passes a failure to its own caller only, and lets the next function run", async () => {
    const failing = withWriteLock(async () => {
      await sleep(5);
      throw new Error("boom");
    });
    const next = withWriteLock(async () => "still runs");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("still runs");
    // and the lock is free for a later call too
    await expect(withWriteLock(async () => "later")).resolves.toBe("later");
  });

  it("releases the lock when a function throws before its first await", async () => {
    const failing = withWriteLock(() => {
      throw new Error("sync boom");
    });
    await expect(failing).rejects.toThrow("sync boom");
    await expect(withWriteLock(async () => "ok")).resolves.toBe("ok");
  });
});
