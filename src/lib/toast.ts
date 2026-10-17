/** How long a toast stays on the screen. */
export const TOAST_MS = 4000;

/** The toast on the screen now, or null. The id is new for every toast, even one with the same text. */
export type ToastState = { id: number; text: string } | null;

/**
 * What the toast does, apart from drawing it: `show` puts a toast on the screen (replacing the one that is there, with
 * a fresh id, so it shows again from the start) and takes it away after TOAST_MS. `onChange` is told each change.
 * `dispose` stops the timer, for when the screen that shows the toasts goes.
 */
export function createToastStore(onChange: (toast: ToastState) => void, duration = TOAST_MS) {
  let id = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(text: string) {
      clearTimeout(timer);
      id += 1;
      onChange({ id, text });
      timer = setTimeout(() => onChange(null), duration);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
