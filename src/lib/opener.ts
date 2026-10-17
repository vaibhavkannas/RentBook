import { FOCUSABLE_SELECTOR } from "@/lib/focusable";

/**
 * What a sheet gives focus back to when it closes: the control that opened it. A press does not always focus a button
 * (on iOS Safari, and on Safari for the Mac, it does not), so document.activeElement cannot tell which control opened
 * the sheet; the sheet remembers the control that was pressed instead. Written against the few members it reads, so it
 * can be tested without a DOM.
 */

type ElementLike = {
  isConnected: boolean;
  closest: (selector: string) => ElementLike | null;
};

const isElementLike = (value: unknown): value is ElementLike =>
  typeof value === "object" && value !== null && typeof (value as ElementLike).closest === "function";

/** The control a press landed on: the target itself, or the nearest button, link or field around it. */
export function pressedControl(target: unknown): HTMLElement | null {
  return isElementLike(target) ? ((target.closest(FOCUSABLE_SELECTOR) as HTMLElement | null) ?? null) : null;
}

/**
 * The control to give focus back to: the control that was pressed, else the element that has focus. A press is the
 * better witness. It is there for a tap, a click and a key press that clicks a button, and what has focus can be stale:
 * a tap that does not focus a button leaves focus wherever an earlier sheet gave it back to. Focus is what is left for a
 * sheet that something other than a press opened. Either one only if it is still on the page.
 */
export function chooseOpener(found: {
  active: HTMLElement | null;
  body: HTMLElement | null;
  pressed: HTMLElement | null;
}): HTMLElement | null {
  const { active, body, pressed } = found;
  if (pressed && pressed.isConnected) return pressed;
  return active && active !== body && active.isConnected ? active : null;
}

let latest: HTMLElement | null = null;
const installed = new WeakSet<object>();

/** The control of the latest press, if it is still on the page. */
export function lastPressedControl(): HTMLElement | null {
  return latest && latest.isConnected ? latest : null;
}

/**
 * Starts remembering which control was pressed. It listens while an event goes down to its target (the capture phase),
 * so it has seen a press before the page's own handlers act on it, and so before a sheet opens. Once for each
 * document, however many sheets ask.
 */
export function installPressTracker(doc: {
  addEventListener: (type: string, listener: (event: { target: unknown }) => void, capture: boolean) => void;
}): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  const remember = (event: { target: unknown }) => {
    latest = pressedControl(event.target);
  };
  doc.addEventListener("pointerdown", remember, true);
  doc.addEventListener("click", remember, true);
}
