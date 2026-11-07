/**
 * Words the test world and the end-to-end run both need. They are here, in a file that imports nothing, so the runner (which
 * cannot load the server-only modules the world is built on) can read them too.
 */

/** The five portions' names, p1 to p5. */
export const PORTION_NAMES = [
  "First floor, single bedroom",
  "First floor, double bedroom",
  "Second floor, single bedroom",
  "Second floor, double bedroom",
  "Third floor, hall and kitchen",
] as const;

/** The longest portion name the app takes, in one piece: it has no space to wrap at. */
export const LONG_PORTION = "Firstfloorsinglebedroomwiththesouthfacingbalconyandwatertank";

/** The longest tenant name the app takes, in one piece. */
export const LONG_TENANT = "Anantharamakrishnanvenkateswaranmuthukrishnansubramaniamiyer";

/** What the `config` fault says: the words Google's own "Sheet not found" answer gets. The end-to-end run looks for them on the screen. */
export const CONFIG_FAULT_MESSAGE = "Google could not find that Sheet. Check SHEET_ID.";
