import { configError, rateLimited, unavailable } from "@/lib/errors";
import { MAX_NAME_LENGTH } from "@/lib/domain/input-rules";
import { addDays, addMonths, currentYm, firstDayOf, todayIso, ymKey } from "@/lib/domain/year-month";
import type { SheetsGateway } from "@/lib/sheets/gateway";
import { LOG_HEADERS, SETTINGS_HEADERS } from "@/lib/sheets/settings-store";
import { TENANCY_LOG_HEADERS } from "@/lib/sheets/tenancy-log-store";
import { TENANT_HEADERS } from "@/lib/sheets/tenants-store";
import { CONFIG_FAULT_MESSAGE, LONG_PORTION, LONG_TENANT } from "./names";
import { type Entry, monthCell, PORTIONS, scheduleRow, SCHEDULE_HEADERS, seededSettingsGrid } from "./fixtures";

/**
 * Worlds: a whole Sheet, as the tabs of an in-memory gateway (`new FakeGateway(world(...).tabs)`), for the screen tests and the
 * end-to-end run. A world is relative to the day it is made for: M is that day's month in India time, and everything that
 * happens "N days ago" is N India days before it, so the same screens can be tested on a fixed day (2026-10-17) and run on the
 * real one.
 *
 * - `main`: five portions in four states, with a Payments Log and a Tenancy Log, as the table below says.
 * - `empty`: every app tab holds only its headers, and the Schedule has its header and the row of M with no payment in it. (A
 *   Schedule with no month row at all is not a quiet Sheet but a broken one: the app refuses it, "The Schedule tab has no month
 *   rows to copy the format from", so a test of that cuts the row out of this world.)
 * - `fresh`: only the Schedule tab of `main`, as a Sheet the app has not been used with yet.
 * - `long`: `main` with a name of the longest length (60 characters, no spaces) for p1 and for Asha.
 *
 * | Portion | M-2             | M-1      | M | Tenants tab                          | Shows on M                                |
 * | p1      | Asha 2, 5,450   | Asha 3   | Asha 4 | current, agreement ends in 30 days | Paid; agreement soon                      |
 * | p2      | Bala 10, 12,700 | Bala 11  | - | current, no end                     | Pending, hike due (13,335)                |
 * | p3      | Chitra 4, 9,000 | -        | - | current, agreement ended 7 days ago | Pending; owes M-1 (and M from the 6th)    |
 * | p4      | -               | -        | - | none                                | never let                                 |
 * | p5      | Esha 1, 5,100   | Esha 2   | - | closed, moved out on the 1st of M   | Vacant since the 1st of M                 |
 */
export type WorldName = "main" | "empty" | "fresh" | "long";
export type Tabs = Record<string, unknown[][]>;

export { CONFIG_FAULT_MESSAGE, LONG_PORTION, LONG_TENANT };

export const OWNER_EMAIL = "owner@example.com";
export const MEMBER_EMAIL = "member@example.com";

/** The longest name the app takes, in one piece: it has no space to wrap at. */

if (LONG_TENANT.length !== MAX_NAME_LENGTH || LONG_PORTION.length !== MAX_NAME_LENGTH) {
  throw new Error("The long names of the long world must be as long as the app allows.");
}

/** A moment on an India day: `clock` is the India time, "HH:MM". */
const at = (day: string, clock: string): string => new Date(`${day}T${clock}:00+05:30`).toISOString();

type Names = { asha: string; p1: string };

function scheduleTab(now: Date, names: Names): unknown[][] {
  const month = currentYm(now);
  const rows: Array<[offset: number, entries: Entry[]]> = [
    [-2, [[names.asha, 2, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000], null, ["Esha", 1, 5100]]],
    [-1, [[names.asha, 3, 5450], ["Bala", 11, 12700], null, null, ["Esha", 2, 5100]]],
    [0, [[names.asha, 4, 5450], null, null, null, null]],
  ];
  return [
    ["Rent Receipts Schedule"],
    [],
    [...SCHEDULE_HEADERS],
    ...rows.map(([offset, entries], index) => {
      const ym = addMonths(month, offset);
      return scheduleRow(monthCell("text", ym.year, ym.month), entries, index + 4);
    }),
  ];
}

function settingsTab(names: Names): unknown[][] {
  const grid = seededSettingsGrid();
  grid[1][1] = names.p1;
  return grid;
}

function tenantsTab(now: Date, names: Names): unknown[][] {
  const month = currentYm(now);
  const today = todayIso(now);
  const row = (
    id: string,
    portion: string,
    tenant: string,
    phone: string,
    moveIn: string,
    agreementEnd: string,
    advance: number | "",
    moveOut: string,
  ): unknown[] => [
    id, portion, tenant, phone, moveIn, agreementEnd,
    advance, advance === "" ? "" : moveIn, advance === "" ? "" : "Held", "", "", "", moveOut, OWNER_EMAIL, at(moveIn, "10:00"),
  ];
  return [
    [...TENANT_HEADERS],
    row("t-p1", "p1", names.asha, "98765 43210", firstDayOf(addMonths(month, -3)), addDays(today, 30), 10900, ""),
    row("t-p2", "p2", "Bala", "98765 43211", firstDayOf(addMonths(month, -11)), "", 25400, ""),
    row("t-p3", "p3", "Chitra", "98765 43212", firstDayOf(addMonths(month, -5)), addDays(today, -7), 18000, ""),
    row("t-p5", "p5", "Esha", "98765 43214", firstDayOf(addMonths(month, -2)), "", 10200, firstDayOf(month)),
  ];
}

/** The Payments Log: a year-old row and eight rows from the last four India days, oldest first as the app appends them. */
function logTab(now: Date, names: Names): unknown[][] {
  const month = currentYm(now);
  const today = todayIso(now);
  const days = (back: number) => addDays(today, -back);
  const m = ymKey(month);
  const before = ymKey(addMonths(month, -1));
  const log = (day: string, clock: string, forMonth: string, portion: string, tenant: string, amount: number, count: number, received: string, by: string, action: string) =>
    [at(day, clock), forMonth, portion, tenant, amount, count, received, by, action];
  const [p1, p2, , , p5] = PORTIONS.map((portion, index) => (index === 0 ? names.p1 : portion.name));
  return [
    [...LOG_HEADERS],
    log(days(365), "10:15", ymKey(addMonths(month, -12)), p1, "Kiran", 5200, 9, days(365), OWNER_EMAIL, "Logged"),
    log(days(3), "10:10", before, p2, "Bala", 12700, 11, days(3), OWNER_EMAIL, "Logged"),
    log(days(3), "16:40", before, p5, "Esha", 5100, 2, days(3), MEMBER_EMAIL, "Logged"),
    log(days(2), "11:05", before, p5, "Esha", 5100, 2, days(2), OWNER_EMAIL, "Edited"),
    log(days(2), "18:20", before, p1, names.asha, 5450, 3, days(2), MEMBER_EMAIL, "Logged"),
    log(days(1), "09:30", m, p1, names.asha, 5450, 4, days(1), OWNER_EMAIL, "Logged"),
    log(days(1), "09:45", m, p1, names.asha, 5450, 4, "", OWNER_EMAIL, "Undone"),
    log(days(0), "08:20", m, p1, names.asha, 5450, 4, days(0), OWNER_EMAIL, "Logged"),
    log(days(0), "09:10", before, p2, "Bala", 12700, 11, days(0), MEMBER_EMAIL, "Edited"),
  ];
}

/** The Tenancy Log: p1 added, then edited (its phone and its agreement end), and p5's move-out. No name is in it. */
function tenancyLogTab(now: Date): unknown[][] {
  const month = currentYm(now);
  const today = todayIso(now);
  const end = addDays(today, 30);
  return [
    [...TENANCY_LOG_HEADERS],
    [at(firstDayOf(addMonths(month, -3)), "10:00"), "t-p1", "p1", "Added", "", "", "", OWNER_EMAIL],
    [at(addDays(today, -5), "17:30"), "t-p1", "p1", "Edited", "Phone", "", "", OWNER_EMAIL],
    [at(addDays(today, -5), "17:30"), "t-p1", "p1", "Edited", "Agreement end", "", end, OWNER_EMAIL],
    [at(firstDayOf(month), "10:00"), "t-p5", "p5", "Moved out", "Move-out date", "", firstDayOf(month), OWNER_EMAIL],
  ];
}

/**
 * The tabs of a world, as they stand on the day `now` falls on in India time. A world is made fresh on every call, so a test may
 * change what it gets. See the table at the top of this file.
 */
export function world(name: WorldName, now: Date): { tabs: Tabs } {
  const names: Names =
    name === "long" ? { asha: LONG_TENANT, p1: LONG_PORTION } : { asha: "Asha", p1: PORTIONS[0].name };
  if (name === "empty") {
    return {
      tabs: {
        Schedule: [
          ["Rent Receipts Schedule"],
          [],
          [...SCHEDULE_HEADERS],
          scheduleRow(monthCell("text", currentYm(now).year, currentYm(now).month), [null, null, null, null, null], 4),
        ],
        Settings: [[...SETTINGS_HEADERS]],
        "Payments Log": [[...LOG_HEADERS]],
        Tenants: [[...TENANT_HEADERS]],
        "Tenancy Log": [[...TENANCY_LOG_HEADERS]],
      },
    };
  }
  const schedule = scheduleTab(now, names);
  if (name === "fresh") return { tabs: { Schedule: schedule } };
  return {
    tabs: {
      Schedule: schedule,
      Settings: settingsTab(names),
      "Payments Log": logTab(now, names),
      Tenants: tenantsTab(now, names),
      "Tenancy Log": tenancyLogTab(now),
    },
  };
}

/** How a method of the gateway fails: Google not answering, Google limiting requests, a wrong setting (as Google says it), or anything else. */
export type Fault = "unavailable" | "rate-limited" | "config" | "error";
/** The methods that fail now, and how. The object is read on every call, so a test may add or remove a fault while it runs. */
export type Faults = Partial<Record<keyof SheetsGateway, Fault>>;

/** An empty set of faults (or a copy of `initial`) for `withFaults`. */
export const faults = (initial: Faults = {}): Faults => ({ ...initial });

const FAILURES: Record<Fault, () => Error> = {
  unavailable,
  "rate-limited": rateLimited,
  config: () => configError(CONFIG_FAULT_MESSAGE),
  error: () => new Error("The gateway failed on purpose."),
};

const METHODS: Record<keyof SheetsGateway, true> = {
  listTabs: true,
  addTab: true,
  getValues: true,
  getManyValues: true,
  updateValues: true,
  appendRow: true,
  appendRows: true,
  ensureColumnCount: true,
  cloneRow: true,
};

/** Wraps any gateway so that the methods named in `faults` throw the failure they are given, and the others do what they always did. */
export function withFaults(inner: SheetsGateway, faults: Faults): SheetsGateway {
  const wrapped: Record<string, unknown> = {};
  for (const method of Object.keys(METHODS) as Array<keyof SheetsGateway>) {
    wrapped[method] = async (...args: unknown[]) => {
      const fault = faults[method];
      if (fault !== undefined) throw FAILURES[fault]();
      return (inner[method] as (...call: unknown[]) => Promise<unknown>).apply(inner, args);
    };
  }
  return wrapped as unknown as SheetsGateway;
}
