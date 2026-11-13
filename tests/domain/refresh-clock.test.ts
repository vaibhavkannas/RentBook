import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshClock } from "@/lib/refresh-clock";
import { beginWrite, liveOverlay, rollbackWrite, settleWrite, SETTLED_CAP_MS, type Change } from "@/lib/optimistic";

// A load that was asked for before a write was confirmed cannot contain the write, so its arrival must not undo it (the card
// flickering Paid, Pending, Paid). The clock gives loads and confirmed writes numbers in one order.

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const log = (portionId: string): Change => ({ kind: "log", portionId, amount: 5450 });

/** What the screen does: begin, then on the answer settle (clock number and time) and ask for a load. */
function screen() {
  const clock = createRefreshClock();
  let overlay = {};
  const live = () => liveOverlay(overlay, clock.getState().arrivedSeq, Date.now());
  return {
    clock,
    live,
    begin: (id: string) => (overlay = beginWrite(overlay, "2026-10", log(id))),
    confirm: (id: string) => (overlay = settleWrite(overlay, "2026-10", id, clock.confirmWrite(), Date.now())),
    fail: (id: string) => (overlay = rollbackWrite(overlay, "2026-10", id)),
  };
}

describe("the normal case", () => {
  it("keeps the change through its own answer and drops it when the load asked for after it arrives", () => {
    const s = screen();
    s.begin("p1");
    s.confirm("p1");
    s.clock.startLoad();
    expect(Object.keys(s.live())).toHaveLength(1);
    s.clock.arrive();
    expect(s.live()).toEqual({});
  });
});

describe("a load that started before the write landed (the foreground refresh)", () => {
  it("does not undo the write when it arrives first; the load asked for after the write ends the change", () => {
    const s = screen();
    s.clock.startLoad(); // the foreground refresh, asked for before the write
    s.begin("p1");
    s.confirm("p1");
    s.clock.startLoad(); // the write's own load
    s.clock.arrive(); // the foreground one arrives: its data cannot contain the write
    expect(Object.keys(s.live())).toHaveLength(1);
    s.clock.arrive();
    expect(s.live()).toEqual({});
  });
});

describe("another portion's write", () => {
  it("ends its own change with its own load and not the other portion's, which was confirmed later", () => {
    const s = screen();
    s.begin("p1");
    s.confirm("p1");
    s.clock.startLoad();
    s.begin("p2");
    s.confirm("p2");
    s.clock.startLoad();
    s.clock.arrive(); // the load of p1's write: it may hold p1's payment, not p2's
    expect(Object.values(s.live()).map((e) => e.change.portionId)).toEqual(["p2"]);
    s.clock.arrive();
    expect(s.live()).toEqual({});
  });
});

describe("a write that really failed", () => {
  it("leaves nothing to wait for, so no later load matters", () => {
    const s = screen();
    s.begin("p1");
    s.fail("p1");
    expect(s.live()).toEqual({});
  });
});

describe("a load nobody here asked for", () => {
  it("is not counted, so it cannot end a change", () => {
    const s = screen();
    s.begin("p1");
    s.confirm("p1");
    s.clock.arrive(); // the back refresh: nothing was waiting
    expect(Object.keys(s.live())).toHaveLength(1);
  });
});

describe("a load that never comes", () => {
  it("lets the change go after the cap, when the screen looks again", () => {
    const s = screen();
    const seen = vi.fn();
    s.clock.subscribe(seen);
    s.begin("p1");
    s.confirm("p1");
    s.clock.startLoad();
    vi.advanceTimersByTime(SETTLED_CAP_MS);
    s.clock.poke();
    expect(seen).toHaveBeenCalled();
    expect(s.live()).toEqual({});
  });
});
