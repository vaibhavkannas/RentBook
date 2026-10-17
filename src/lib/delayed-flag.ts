/**
 * A flag that turns on once `delayMs` has passed since `start()`, unless `stop()` comes first; `stop()` turns it off again.
 * It is what shows "Still working" under a button when a save takes long. `onChange` hears each change, never the same
 * value twice in a row. Pure of React, so it can be tested with fake timers.
 */
export function createDelayedFlag(delayMs: number, onChange: (on: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let on = false;

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (on) {
      on = false;
      onChange(false);
    }
  }

  function start() {
    stop();
    timer = setTimeout(() => {
      timer = null;
      on = true;
      onChange(true);
    }, delayMs);
  }

  return { start, stop };
}
