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
