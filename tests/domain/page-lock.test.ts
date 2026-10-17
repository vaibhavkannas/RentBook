import { afterEach, describe, expect, it, vi } from "vitest";
import { createLock, SHEET_OPEN_CLASS, sheetLock } from "@/lib/page-lock";

// The page behind an open sheet does not scroll. Every sheet takes the lock when it opens and gives it back when it
// closes; the page unlocks only when the last one has gone, so closing one of two sheets never frees the page behind
// the other.

function counted() {
  const log: string[] = [];
  const lock = createLock(
    () => log.push("lock"),
    () => log.push("unlock"),
  );
  return { lock, log };
}

describe("createLock", () => {
  it("locks when the first holder acquires it, and only then", () => {
    const { lock, log } = counted();
    lock.acquire();
    expect(log).toEqual(["lock"]);
    lock.acquire();
    lock.acquire();
    expect(log).toEqual(["lock"]);
    expect(lock.count).toBe(3);
  });

  it("unlocks when the last holder releases it, and not before", () => {
    const { lock, log } = counted();
    lock.acquire();
    lock.acquire();
    lock.release();
    expect(log).toEqual(["lock"]);
    expect(lock.count).toBe(1);
    lock.release();
    expect(log).toEqual(["lock", "unlock"]);
    expect(lock.count).toBe(0);
  });

  it("keeps the page locked when one of two sheets closes", () => {
    const { lock, log } = counted();
    lock.acquire(); // sheet A opens
    lock.acquire(); // sheet B opens
    lock.release(); // A closes
    expect(log).toEqual(["lock"]);
    lock.release(); // B closes
    expect(log).toEqual(["lock", "unlock"]);
  });

  it("ignores a release that was never acquired, and is not left in debt by it", () => {
    const { lock, log } = counted();
    lock.release();
    lock.release();
    expect(log).toEqual([]);
    expect(lock.count).toBe(0);
    lock.acquire();
    expect(log).toEqual(["lock"]);
    lock.release();
    expect(log).toEqual(["lock", "unlock"]);
  });

  it("ends locked after React's development double run of an effect (acquire, release, acquire)", () => {
    const { lock, log } = counted();
    lock.acquire();
    lock.release();
    lock.acquire();
    expect(log).toEqual(["lock", "unlock", "lock"]);
    expect(lock.count).toBe(1);
  });
});

describe("sheetLock", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeDocument() {
    const classes = new Set<string>();
    vi.stubGlobal("document", {
      documentElement: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } },
    });
    return classes;
  }

  it("puts the sheet-open class on <html> for as long as any sheet is open", () => {
    const classes = fakeDocument();
    expect(SHEET_OPEN_CLASS).toBe("sheet-open");
    sheetLock.acquire();
    sheetLock.acquire();
    expect(classes.has("sheet-open")).toBe(true);
    sheetLock.release();
    expect(classes.has("sheet-open")).toBe(true);
    sheetLock.release();
    expect(classes.has("sheet-open")).toBe(false);
    expect(sheetLock.count).toBe(0);
  });
});
