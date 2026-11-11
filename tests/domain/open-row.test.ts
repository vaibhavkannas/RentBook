import { describe, expect, it, vi } from "vitest";
import { createOpenRowStore } from "@/lib/open-row";

describe("the open row of the month screen", () => {
  it("starts with no row open", () => {
    expect(createOpenRowStore().get()).toBeNull();
  });

  it("opens a row, and a tap on the open row closes it", () => {
    const store = createOpenRowStore();
    store.toggle("p1");
    expect(store.get()).toBe("p1");
    store.toggle("p1");
    expect(store.get()).toBeNull();
  });

  it("keeps one row open at a time: opening another closes the first", () => {
    const store = createOpenRowStore();
    store.toggle("p1");
    store.toggle("p2");
    expect(store.get()).toBe("p2");
  });

  it("tells its listeners of each change, and not once they have left", () => {
    const store = createOpenRowStore();
    const listener = vi.fn();
    const leave = store.subscribe(listener);
    store.toggle("p1");
    store.close();
    expect(listener).toHaveBeenCalledTimes(2);
    leave();
    store.toggle("p2");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not tell anyone when closing changes nothing", () => {
    const store = createOpenRowStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.close();
    expect(listener).not.toHaveBeenCalled();
  });
});
