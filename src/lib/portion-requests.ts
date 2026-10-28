import { parseSettingsRows } from "@/lib/settings-input";

/**
 * What the Portion settings screen sends for a new portion, and the moves of the order editor. The screens only gather
 * text; the rules about what is sent, and what is wrong, live here so they can be tested. The server checks everything again.
 */

/** The Add a portion sheet's own names for the fields a message can be about. */
export const ADD_PORTION_FIELDS = ["name", "cycle", "hike"] as const;

/** Shown when the name field is blank. (A name that is too long says what the settings say.) */
export const PORTION_NAME_BLANK_MESSAGE = "Enter the portion's name.";

/** The Add a portion sheet, as typed. */
export type AddPortionForm = { name: string; cycle: string; never: boolean; hike: string };

export type AddPortionRequest =
  | { ok: true; body: { name: string; cycleLength: number | null; hikePercent: number } }
  /** `field` is the sheet's own name for the field the message is about. */
  | { ok: false; message: string; field: (typeof ADD_PORTION_FIELDS)[number] };

/**
 * The body of POST /api/portions, or what is wrong with the form and in which field, in the order the fields are on the
 * screen (name, payments per cycle, hike). The rules for a cycle length and a hike are the settings form's own
 * (parseSettingsRows): a portion that is added is held to what one that is edited is. A mistyped cycle never becomes
 * "count never resets": only the tick box can do that.
 */
export function buildAddPortionRequest(form: AddPortionForm): AddPortionRequest {
  if (form.name.trim() === "") return { ok: false, message: PORTION_NAME_BLANK_MESSAGE, field: "name" };
  const parsed = parseSettingsRows([{ id: "new", name: form.name, cycle: form.cycle, never: form.never, hike: form.hike }]);
  if (!parsed.ok) return { ok: false, message: parsed.message, field: parsed.field };
  const { name, cycleLength, hikePercent } = parsed.portions[0];
  return { ok: true, body: { name, cycleLength, hikePercent } };
}

/**
 * `ids` with the one at `index` moved one place up (`delta` -1) or down (+1): it swaps with its neighbour. A move off either
 * end, by more than one place, or from a place that is not there leaves the order as it was. Always a new list.
 */
export function moveInOrder(ids: readonly string[], index: number, delta: number): string[] {
  const next = [...ids];
  const target = index + delta;
  if (!Number.isInteger(index) || Math.abs(delta) !== 1 || index < 0 || index >= ids.length || target < 0 || target >= ids.length) {
    return next;
  }
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Whether two orders are the same ids in the same places. */
export const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, at) => id === b[at]);

/** What the order editor says after a move: where the portion is now (`index` counts from 0). */
export const orderPositionText = (name: string, index: number, total: number): string =>
  `${name} is now ${index + 1} of ${total}.`;
