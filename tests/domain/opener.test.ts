import { describe, expect, it } from "vitest";
import { chooseOpener, installPressTracker, lastPressedControl, pressedControl } from "@/lib/opener";

// What a sheet gives focus back to when it closes. A tapped button does not take focus on iOS Safari (or on Safari
// for the Mac), so then document.activeElement is the page itself and the sheet must remember the button that was
// pressed. There is no DOM here: the elements are stand-ins with the few members the helpers read.

type Fake = { name: string; isConnected: boolean; closest: (selector: string) => Fake | null };
type FakeElement = Fake & HTMLElement;

/** A control (it matches the focusable selector), and a plain element inside it or outside any. */
function control(name: string, isConnected = true): FakeElement {
  const self: Fake = { name, isConnected, closest: () => self };
  return self as unknown as FakeElement;
}
function inside(name: string, parent: Fake | null): FakeElement {
  const self: Fake = { name, isConnected: parent?.isConnected ?? true, closest: (selector) => parent?.closest(selector) ?? null };
  return self as unknown as FakeElement;
}

describe("pressedControl", () => {
  it("is the button or link a press landed on", () => {
    const button = control("Log payment");
    expect(pressedControl(button)).toBe(button);
  });

  it("is the nearest control around the element that was hit, such as the text inside a button", () => {
    const button = control("Undo");
    expect(pressedControl(inside("span", button))).toBe(button);
  });

  it("is null for a press on something that is not in a control", () => {
    expect(pressedControl(inside("div", null))).toBeNull();
  });

  it("is null for a target that is not an element at all", () => {
    expect(pressedControl(null)).toBeNull();
    expect(pressedControl(undefined)).toBeNull();
    expect(pressedControl({})).toBeNull();
    expect(pressedControl("button")).toBeNull();
  });

  it("looks for the controls Tab can reach, links and buttons among them", () => {
    let asked = "";
    pressedControl({ closest: (selector: string) => ((asked = selector), null) });
    for (const part of ["a[href]", "button", "summary", "input"]) expect(asked).toContain(part);
  });
});

describe("chooseOpener", () => {
  const body = control("body");

  it("is the control that was pressed, as on iOS Safari after a tap, when the page itself has focus", () => {
    const pressed = control("Log payment");
    expect(chooseOpener({ active: body, body, pressed })).toBe(pressed);
    expect(chooseOpener({ active: null, body, pressed })).toBe(pressed);
  });

  it("is the control that was pressed even when another element has focus, because that focus can be stale", () => {
    const pressed = control("title button");
    const stale = control("Log payment, given focus back by an earlier sheet");
    expect(chooseOpener({ active: stale, body, pressed })).toBe(pressed);
  });

  it("is the element that has focus when no press is known, as for a sheet opened by code", () => {
    const active = control("title button");
    expect(chooseOpener({ active, body, pressed: null })).toBe(active);
  });

  it("is null when there is neither a pressed control nor a focused element", () => {
    expect(chooseOpener({ active: body, body, pressed: null })).toBeNull();
    expect(chooseOpener({ active: null, body: null, pressed: null })).toBeNull();
  });

  it("does not take a pressed control that has left the page since, but falls back to the focused element", () => {
    const active = control("title button");
    expect(chooseOpener({ active: body, body, pressed: control("gone", false) })).toBeNull();
    expect(chooseOpener({ active, body, pressed: control("gone", false) })).toBe(active);
  });

  it("does not take a focused element that has left the page", () => {
    expect(chooseOpener({ active: control("gone", false), body, pressed: null })).toBeNull();
  });
});

describe("the press tracker", () => {
  type Listener = (event: { target: unknown }) => void;
  function fakeDocument() {
    const listeners = new Map<string, { listener: Listener; capture: unknown }[]>();
    return {
      listeners,
      addEventListener(type: string, listener: Listener, options?: unknown) {
        listeners.set(type, [...(listeners.get(type) ?? []), { listener, capture: options }]);
      },
      fire(type: string, target: unknown) {
        for (const { listener } of listeners.get(type) ?? []) listener({ target });
      },
    };
  }

  it("remembers the control of the latest press, from a pointer press and from a click", () => {
    const doc = fakeDocument();
    installPressTracker(doc);
    const first = control("first");
    const second = control("second");
    doc.fire("pointerdown", first);
    expect(lastPressedControl()).toBe(first);
    doc.fire("click", second);
    expect(lastPressedControl()).toBe(second);
  });

  it("listens while the event goes down to its target, so it sees the press before the page's own handlers do", () => {
    const doc = fakeDocument();
    installPressTracker(doc);
    for (const type of ["pointerdown", "click"]) {
      expect(doc.listeners.get(type)?.every((entry) => entry.capture === true || (entry.capture as { capture?: boolean })?.capture === true)).toBe(true);
    }
  });

  it("forgets a control that is no longer on the page", () => {
    const doc = fakeDocument();
    installPressTracker(doc);
    const gone = control("gone");
    doc.fire("pointerdown", gone);
    (gone as Fake).isConnected = false;
    expect(lastPressedControl()).toBeNull();
  });

  it("forgets the last control when the latest press landed on something that is not a control", () => {
    const doc = fakeDocument();
    installPressTracker(doc);
    const button = control("Log payment");
    doc.fire("pointerdown", button);
    doc.fire("pointerdown", inside("div", null));
    expect(lastPressedControl()).toBeNull();
  });

  it("is installed once for a document, however many sheets ask", () => {
    const doc = fakeDocument();
    installPressTracker(doc);
    installPressTracker(doc);
    expect(doc.listeners.get("pointerdown")).toHaveLength(1);
    expect(doc.listeners.get("click")).toHaveLength(1);
  });
});
