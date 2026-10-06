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

export type ParsedSettings =
  | { ok: true; portions: SettingsPayload[] }
  | { ok: false; message: string };

const MAX_CYCLE = 120;

/**
 * Turns the settings form's text fields into the request body, or says what is
 * wrong. A mistyped cycle length must never become "count never resets": only
 * the checkbox can do that.
 */
export function parseSettingsRows(rows: SettingsRowInput[]): ParsedSettings {
  const portions: SettingsPayload[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const label = name || row.id;
    if (name.length === 0 || name.length > 60) {
      return { ok: false, message: `${label}: the name must be 1 to 60 characters.` };
    }

    const hike = row.hike.trim();
    if (!/^\d+(\.\d+)?$/.test(hike) || Number(hike) > 100) {
      return {
        ok: false,
        message: `${label}: hike % must be a number from 0 to 100. Use a dot for decimals.`,
      };
    }

    let cycleLength: number | null = null;
    if (!row.never) {
      const cycle = row.cycle.trim();
      if (!/^\d+$/.test(cycle) || Number(cycle) < 1 || Number(cycle) > MAX_CYCLE) {
        return {
          ok: false,
          message: `${label}: cycle length must be a whole number from 1 to ${MAX_CYCLE}. To stop the count ever resetting, tick "Count never resets".`,
        };
      }
      cycleLength = Number(cycle);
    }

    portions.push({ id: row.id, name, cycleLength, hikePercent: Number(hike) });
  }
  return { ok: true, portions };
}
