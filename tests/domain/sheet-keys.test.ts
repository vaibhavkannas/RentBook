import { describe, expect, it } from "vitest";
import { sheetKeyAction } from "@/lib/sheet-keys";

// What a bottom sheet does with a key press: close on Escape (only while it may), keep Tab inside by wrapping at the
// ends, and hold focus on the sheet when there is nothing in it to move to.

const press = (over: Partial<Parameters<typeof sheetKeyAction>[0]> = {}) =>
  sheetKeyAction({ key: "Tab", shiftKey: false, canClose: true, itemCount: 4, activeIndex: 1, ...over });

describe("Escape", () => {
  it("closes the sheet while it may be closed", () => {
    expect(press({ key: "Escape" })).toEqual({ type: "close" });
  });

  it("does nothing while something is being saved", () => {
    expect(press({ key: "Escape", canClose: false })).toBeNull();
  });

  it("closes whatever has focus, and whether or not there is anything to focus", () => {
    expect(press({ key: "Escape", activeIndex: -1, itemCount: 0 })).toEqual({ type: "close" });
    expect(press({ key: "Escape", shiftKey: true, activeIndex: 3 })).toEqual({ type: "close" });
  });
});

describe("Tab", () => {
  it("leaves a press in the middle of the sheet to the browser", () => {
    expect(press({ activeIndex: 0 })).toBeNull();
    expect(press({ activeIndex: 1 })).toBeNull();
    expect(press({ activeIndex: 2 })).toBeNull();
  });

  it("wraps from the last control to the first", () => {
    expect(press({ activeIndex: 3 })).toEqual({ type: "focus", index: 0 });
  });

  it("goes backwards through the middle with Shift+Tab, left to the browser", () => {
    expect(press({ shiftKey: true, activeIndex: 3 })).toBeNull();
    expect(press({ shiftKey: true, activeIndex: 1 })).toBeNull();
  });

  it("wraps from the first control to the last with Shift+Tab", () => {
    expect(press({ shiftKey: true, activeIndex: 0 })).toEqual({ type: "focus", index: 3 });
  });

  it("brings focus in from the sheet itself (or from outside it): first control for Tab, last for Shift+Tab", () => {
    expect(press({ activeIndex: -1 })).toEqual({ type: "focus", index: 0 });
    expect(press({ activeIndex: -1, shiftKey: true })).toEqual({ type: "focus", index: 3 });
  });

  it("keeps focus on a lone control, whichever way Tab goes", () => {
    expect(press({ itemCount: 1, activeIndex: 0 })).toEqual({ type: "focus", index: 0 });
    expect(press({ itemCount: 1, activeIndex: 0, shiftKey: true })).toEqual({ type: "focus", index: 0 });
  });

  it("keeps focus on the sheet when there is nothing in it to move to (everything is disabled while it saves)", () => {
    expect(press({ itemCount: 0, activeIndex: -1 })).toEqual({ type: "focus-panel" });
    expect(press({ itemCount: 0, activeIndex: -1, shiftKey: true })).toEqual({ type: "focus-panel" });
  });

  it("cycles through every control and back, in either direction, and never lands outside", () => {
    const count = 5;
    let at = 0;
    for (let i = 0; i < 12; i++) {
      const action = press({ itemCount: count, activeIndex: at });
      at = action?.type === "focus" ? action.index : (at + 1) % count; // null: the browser moves to the next one
      expect(at).toBe((i + 1) % count);
    }
    at = 0;
    for (let i = 0; i < 12; i++) {
      const action = press({ itemCount: count, activeIndex: at, shiftKey: true });
      at = action?.type === "focus" ? action.index : (at - 1 + count) % count;
      expect(at).toBe((((-(i + 1)) % count) + count) % count);
    }
  });
});

describe("other keys", () => {
  it.each(["Enter", " ", "a", "ArrowDown", "Shift", "Backspace"])("%s is left alone", (key) => {
    expect(press({ key })).toBeNull();
    expect(press({ key, itemCount: 0 })).toBeNull();
  });
});
