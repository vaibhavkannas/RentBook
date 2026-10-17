/**
 * How the app tells a person to bring a screen that is out of date up to date. The installed app has no pull to refresh and
 * there is no refresh button, but tapping another tab of the bar at the bottom of the screen loads that screen, and coming
 * back loads this one again, in a browser and in the installed app, so that is what every message says. It names the bar
 * ("at the bottom of the screen") because a browser has tabs of its own and the Sheet has tabs too, and neither does this.
 * The words are here and nowhere else (tests/server/recovery-wording.test.ts finds any message in src that says
 * "refresh" or "reload", or says the step in words of its own). No imports, so the browser's code and the server's can both
 * use it.
 */

/** The tap, in lower case, for a sentence that begins with something else. */
const TAP = "tap another tab at the bottom of the screen";

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The step itself, in lower case, for a sentence that begins with something else. */
export const RELOAD_STEP = `${TAP} and come back`;

/**
 * The step as a sentence of its own, and what to do after it: "Tap another tab at the bottom of the screen and come back,
 * then try again." Say what to do after it truthfully: "check the card" where there is nothing left to try again.
 */
export const reloadThen = (action: string): string => `${capitalised(RELOAD_STEP)}, then ${action}.`;

/** The usual one: after the step, try again. */
export const RELOAD_HINT = reloadThen("try again");

/** For a person who has been signed out: the next screen is the sign-in page, so there is no coming back to say. */
export const SIGN_IN_HINT = `${capitalised(TAP)} to sign in again.`;
