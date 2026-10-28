import type { PortionConfig } from "@/lib/domain/types";

export type SettingsRowInput = {
  id: string;
  name: string;
  cycle: string;
  never: boolean;
  hike: string;
};

export type SettingsPayload = {
  id: string;
  name: string;
  cycleLength: number | null;
  hikePercent: number;
};

/** Which field of a row is wrong: the settings form's own names for them. */
export type SettingsField = "name" | "cycle" | "hike";

export type ParsedSettings =
  | { ok: true; portions: SettingsPayload[] }
  | { ok: false; message: string; rowId: string; field: SettingsField };

const MAX_CYCLE = 120;

/**
 * Turns the settings form's text fields into the request body, or says what is
 * wrong, and in which field of which row, so the form can show it under that field. The fields are looked at in the
 * order they are on the screen (name, payments per cycle, hike), row by row. A mistyped cycle length must never become
 * "count never resets": only the checkbox can do that.
 */
export function parseSettingsRows(rows: SettingsRowInput[]): ParsedSettings {
  const portions: SettingsPayload[] = [];
  for (const row of rows) {
    const refuse = (field: SettingsField, message: string): ParsedSettings => ({ ok: false, message, rowId: row.id, field });

    const name = row.name.trim();
    if (name.length === 0 || name.length > 60) return refuse("name", "Portion name must be 1 to 60 characters.");

    let cycleLength: number | null = null;
    if (!row.never) {
      const cycle = row.cycle.trim();
      if (!/^\d+$/.test(cycle) || Number(cycle) < 1 || Number(cycle) > MAX_CYCLE) {
        return refuse(
          "cycle",
          `Payments per cycle must be a whole number from 1 to ${MAX_CYCLE}. To stop the count resetting, tick "Count never resets".`,
        );
      }
      cycleLength = Number(cycle);
    }

    const hike = row.hike.trim();
    if (!/^\d+(\.\d+)?$/.test(hike) || Number(hike) > 100) {
      return refuse("hike", "Hike must be a number from 0 to 100. Use a dot for decimals, like 5.5.");
    }

    portions.push({ id: row.id, name, cycleLength, hikePercent: Number(hike) });
  }
  return { ok: true, portions };
}

/** The form's row for a portion, from what the Sheet holds. A portion with no cycle ticks "Count never resets" and leaves the usual 11 behind it. */
export const rowFromPortion = (p: PortionConfig): SettingsRowInput => ({
  id: p.id,
  name: p.name,
  cycle: p.cycleLength === null ? "11" : String(p.cycleLength),
  never: p.cycleLength === null,
  hike: String(p.hikePercent),
});

/** The portions that are on: the form edits those only. A switched-off portion has its own place on the screen. */
export const onPortions = (portions: readonly PortionConfig[]): PortionConfig[] => portions.filter((portion) => !portion.inactive);

/**
 * The form's rows after the portions changed (one was added, switched off or on, or the order was saved): a row for each portion
 * that is on, in the order of `portions`. A portion that already has a row keeps it, with whatever was typed in it and not yet
 * saved; a portion that has none gets one from what the Sheet holds; a portion that is off or gone loses its row.
 */
export function reconcileRows(current: readonly SettingsRowInput[], portions: readonly PortionConfig[]): SettingsRowInput[] {
  const typed = new Map(current.map((row) => [row.id, row]));
  return onPortions(portions).map((portion) => typed.get(portion.id) ?? rowFromPortion(portion));
}
