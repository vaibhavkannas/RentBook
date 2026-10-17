/**
 * How the app tells a person to bring a screen that is out of date up to date. The installed app has no pull to refresh and
 * there is no refresh button, but switching to another tab loads the screen again, in a browser and in the installed app, so
 * that is what every message says. The words are here and nowhere else (tests/server/recovery-wording.test.ts finds any
 * message in src that says "refresh" or "reload"). No imports, so the browser's code and the server's can both use it.
 */

/** The step itself, in lower case, for a sentence that begins with something else. */
export const RELOAD_STEP = "switch to another tab and back";

/** The step as a sentence of its own, and what to do after it: "Switch to another tab and back, then try again." */
export const reloadThen = (action: string): string =>
  `${RELOAD_STEP.charAt(0).toUpperCase()}${RELOAD_STEP.slice(1)}, then ${action}.`;

/** The usual one: after the step, try again. */
export const RELOAD_HINT = reloadThen("try again");
