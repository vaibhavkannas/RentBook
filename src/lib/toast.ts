/** How long a toast stays on the screen. */
export const TOAST_MS = 4000;

/** How long a toast that offers something to press ("Undo", "Try again") stays: long enough to read it and reach it. */
export const ACTION_TOAST_MS = 8000;

/** What a toast offers to press: a label, and what pressing it does. */
export type ToastAction = { label: string; onPress: () => void };

/** The toast on the screen now, or null. The id is new for every toast, even one with the same text. */
export type ToastState = { id: number; text: string; action?: ToastAction } | null;

/**
 * What the toast does, apart from drawing it: `show` puts a toast on the screen (replacing the one that is there, with
 * a fresh id, so it shows again from the start) and takes it away after TOAST_MS, or after ACTION_TOAST_MS when it offers
 * an action. `onChange` is told each change. `dispose` stops the timer, for when the screen that shows the toasts goes.
 */
export function createToastStore(onChange: (toast: ToastState) => void, duration = TOAST_MS, actionDuration = ACTION_TOAST_MS) {
  let id = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(text: string, action?: ToastAction) {
      clearTimeout(timer);
      id += 1;
      onChange(action ? { id, text, action } : { id, text });
      timer = setTimeout(() => onChange(null), action ? actionDuration : duration);
    },
    /** Takes the toast away now (the action was pressed). */
    hide() {
      clearTimeout(timer);
      onChange(null);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
