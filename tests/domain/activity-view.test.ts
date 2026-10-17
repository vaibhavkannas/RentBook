import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SHOWN_LIMIT,
  DATE_NOT_RECORDED,
  UNKNOWN_DAY_KEY,
  activityHref,
  dayHeading,
  filterActivity,
  groupByDay,
  parseActivityFilters,
  portionsIn,
  toActivityEntry,
  withKnownPortion,
  type ActivityFilters,
} from "@/lib/activity-view";
import type { ActivityItem } from "@/lib/sheets/service";

// What the Activity screen says about each Payments Log row, which day it is under, and how it is filtered. All pure.

const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  savedAt: "2026-10-05T04:30:00.000Z",
  month: "2026-10",
  portion: "Ground floor",
  tenant: "Asha",
  amount: 10000,
  count: 4,
  dateReceived: "2026-10-05",
  loggedBy: "owner@example.com",
  action: "Logged",
  ...overrides,
});

const VIEWER = "member@example.com";
const entry = (overrides: Partial<ActivityItem> = {}, viewer: string | null | undefined = VIEWER) =>
  toActivityEntry(item(overrides), viewer);

describe("the limit", () => {
  it("shows the newest 50 of the rows that match, out of the whole log", () => {
    expect(ACTIVITY_SHOWN_LIMIT).toBe(50);
  });
});

describe("toActivityEntry", () => {
  describe("a payment that was logged", () => {
    it("has a green Logged pill and says what came in, from whom, for which month, and which payment it was", () => {
      expect(entry()).toEqual({
        portion: "Ground floor",
        tone: "success",
        label: "Logged",
        summary: "Logged ₹ 10,000 from Asha for October 2026 (payment 4).",
        amount: "₹ 10,000",
        struck: false,
        meta: "10:00 am · by owner@example.com · received 5 Oct",
      });
    });

    it("writes the amount with Indian grouping", () => {
      expect(entry({ amount: 1234567 }).summary).toBe("Logged ₹ 12,34,567 from Asha for October 2026 (payment 4).");
    });

    it("keeps a real amount of nothing: ₹ 0 is something somebody typed", () => {
      expect(entry({ amount: 0 }).summary).toBe("Logged ₹ 0 from Asha for October 2026 (payment 4).");
      expect(entry({ amount: 0 }).amount).toBe("₹ 0");
    });
  });

  describe("a payment that was changed", () => {
    it("has an amber Changed pill and says what it was changed to", () => {
      expect(entry({ action: "Edited", amount: 9500, count: 4 })).toEqual({
        portion: "Ground floor",
        tone: "warn",
        label: "Changed",
        summary: "Changed Asha's October 2026 payment to ₹ 9,500.",
        amount: "₹ 9,500",
        struck: false,
        meta: "10:00 am · by owner@example.com · received 5 Oct",
      });
    });
  });

  describe("a payment that was undone", () => {
    it("has a red Undone pill, says which payment was taken back, and marks the amount to be struck through", () => {
      expect(entry({ action: "Undone", dateReceived: "" })).toEqual({
        portion: "Ground floor",
        tone: "danger",
        label: "Undone",
        summary: "Undid Asha's October 2026 payment of ₹ 10,000.",
        amount: "₹ 10,000",
        struck: true,
        meta: "10:00 am · by owner@example.com",
      });
    });

    it("never says when the money was received, even if a hand-edited row has a date there", () => {
      expect(entry({ action: "Undone", dateReceived: "2026-10-05" }).meta).toBe("10:00 am · by owner@example.com");
    });
  });

  describe("an older row with no action", () => {
    it("has a neutral Entry pill and says only what the row holds", () => {
      expect(entry({ action: null, loggedBy: "", count: null, dateReceived: "" })).toEqual({
        portion: "Ground floor",
        tone: "neutral",
        label: "Entry",
        summary: "₹ 10,000 from Asha for October 2026.",
        amount: "₹ 10,000",
        struck: false,
        meta: "10:00 am · who: not recorded",
      });
    });

    it("does not say when the money was received, as it never says which kind of entry it is", () => {
      expect(entry({ action: null, dateReceived: "2026-10-05" }).meta).not.toContain("received");
    });

    it("does not say the payment number either: the table leaves it out", () => {
      expect(entry({ action: null, count: 7 }).summary).toBe("₹ 10,000 from Asha for October 2026.");
    });
  });

  describe("who did it", () => {
    it("says by you for the signed-in person's own address, however it is written", () => {
      expect(entry({ loggedBy: "member@example.com" }).meta).toBe("10:00 am · by you · received 5 Oct");
      expect(entry({ loggedBy: "Member@Example.COM" }).meta).toBe("10:00 am · by you · received 5 Oct");
      expect(entry({ loggedBy: "  member@example.com  " }).meta).toBe("10:00 am · by you · received 5 Oct");
      expect(entry({ loggedBy: "member@example.com" }, "MEMBER@example.com").meta).toContain("by you");
    });

    it("says by and the address for anyone else, as it is stored", () => {
      expect(entry({ loggedBy: "Owner@Example.com" }).meta).toBe("10:00 am · by Owner@Example.com · received 5 Oct");
      expect(entry({ loggedBy: "member@mail.example.com" }).meta).toContain("by member@mail.example.com");
      expect(entry({ loggedBy: "xmember@example.com" }).meta).toContain("by xmember@example.com");
    });

    it("says who: not recorded when the address is blank, even when the viewer's own address is blank too", () => {
      expect(entry({ loggedBy: "" }).meta).toBe("10:00 am · who: not recorded · received 5 Oct");
      expect(entry({ loggedBy: "   " }).meta).toContain("who: not recorded");
      expect(entry({ loggedBy: "" }, "").meta).toContain("who: not recorded");
      expect(entry({ loggedBy: "" }, null).meta).toContain("who: not recorded");
      expect(entry({ loggedBy: "" }, undefined).meta).toContain("who: not recorded");
    });

    it("is not by you when nobody is signed in", () => {
      expect(entry({ loggedBy: "owner@example.com" }, "").meta).toContain("by owner@example.com");
      expect(entry({ loggedBy: "owner@example.com" }, null).meta).toContain("by owner@example.com");
    });
  });

  describe("the day money was received", () => {
    it("is written as day and short month, with no leading zero", () => {
      expect(entry({ dateReceived: "2026-10-01" }).meta).toContain("received 1 Oct");
      expect(entry({ dateReceived: "2026-12-31" }).meta).toContain("received 31 Dec");
      expect(entry({ dateReceived: "2025-03-15" }).meta).toContain("received 15 Mar");
    });

    it("is left out unless it is a real day", () => {
      for (const dateReceived of ["", "   ", "46300", "2026-02-30", "2026-13-01", "soon", "5 Oct", "2026-10-05T04:30:00Z"]) {
        expect(entry({ dateReceived }).meta, dateReceived).toBe("10:00 am · by owner@example.com");
      }
    });
  });

  describe("the time", () => {
    it("is India time", () => {
      expect(entry({ savedAt: "2026-10-05T18:30:00Z" }).meta.startsWith("12:00 am · ")).toBe(true);
      expect(entry({ savedAt: "2026-10-05T13:35:00Z" }).meta.startsWith("7:05 pm · ")).toBe(true);
    });

    it("is left out, with no stray mark, when the saved time cannot be read", () => {
      for (const savedAt of ["", "yesterday", "46300.4166", "2026-10-05"]) {
        expect(entry({ savedAt }).meta, savedAt).toBe("by owner@example.com · received 5 Oct");
        expect(entry({ savedAt, loggedBy: "" }).meta, savedAt).toBe("who: not recorded · received 5 Oct");
        expect(entry({ savedAt, loggedBy: "", dateReceived: "" }).meta, savedAt).toBe("who: not recorded");
      }
    });
  });

  describe("a row with parts missing", () => {
    it("leaves out the amount, and keeps the rest of the sentence", () => {
      expect(entry({ action: "Logged", amount: null }).summary).toBe("Logged from Asha for October 2026 (payment 4).");
      expect(entry({ action: "Edited", amount: null }).summary).toBe("Changed Asha's October 2026 payment.");
      expect(entry({ action: "Undone", amount: null }).summary).toBe("Undid Asha's October 2026 payment.");
      expect(entry({ action: null, amount: null }).summary).toBe("From Asha for October 2026.");
      expect(entry({ amount: null }).amount).toBeNull();
    });

    it("leaves out the payment number", () => {
      expect(entry({ action: "Logged", count: null }).summary).toBe("Logged ₹ 10,000 from Asha for October 2026.");
      expect(entry({ action: "Edited", count: null }).summary).toBe("Changed Asha's October 2026 payment to ₹ 10,000.");
    });

    it("leaves out the tenant", () => {
      expect(entry({ action: "Logged", tenant: "" }).summary).toBe("Logged ₹ 10,000 for October 2026 (payment 4).");
      expect(entry({ action: "Edited", tenant: "" }).summary).toBe("Changed the October 2026 payment to ₹ 10,000.");
      expect(entry({ action: "Undone", tenant: "" }).summary).toBe("Undid the October 2026 payment of ₹ 10,000.");
      expect(entry({ action: null, tenant: "" }).summary).toBe("₹ 10,000 for October 2026.");
      expect(entry({ tenant: "   " }).summary).toBe("Logged ₹ 10,000 for October 2026 (payment 4).");
    });

    it("leaves out the month", () => {
      expect(entry({ action: "Logged", month: "" }).summary).toBe("Logged ₹ 10,000 from Asha (payment 4).");
      expect(entry({ action: "Edited", month: "" }).summary).toBe("Changed Asha's payment to ₹ 10,000.");
      expect(entry({ action: "Undone", month: "" }).summary).toBe("Undid Asha's payment of ₹ 10,000.");
      expect(entry({ action: null, month: "" }).summary).toBe("₹ 10,000 from Asha.");
    });

    it("writes a month as it was typed when it is not a month key, rather than hide it", () => {
      expect(entry({ month: "Oct-26" }).summary).toBe("Logged ₹ 10,000 from Asha for Oct-26 (payment 4).");
    });

    it("says what it can when almost everything is missing", () => {
      const bare = { amount: null, count: null, tenant: "", month: "", dateReceived: "", loggedBy: "" };
      expect(entry({ ...bare, action: "Logged" }).summary).toBe("Logged.");
      expect(entry({ ...bare, action: "Edited" }).summary).toBe("Changed the payment.");
      expect(entry({ ...bare, action: "Undone" }).summary).toBe("Undid the payment.");
      expect(entry({ ...bare, action: null }).summary).toBe("No details recorded.");
    });

    it("never leaves a stray mark, a double space or an empty bracket, whichever parts are missing", () => {
      const actions: ActivityItem["action"][] = ["Logged", "Edited", "Undone", null];
      for (const action of actions) {
        for (let mask = 0; mask < 16; mask++) {
          const row = item({
            action,
            amount: mask & 1 ? null : 5450,
            count: mask & 2 ? null : 2,
            tenant: mask & 4 ? "" : "Asha",
            month: mask & 8 ? "" : "2026-10",
          });
          const { summary } = toActivityEntry(row, VIEWER);
          const where = `${action} mask ${mask}: ${summary}`;
          expect(summary, where).toMatch(/^[A-Z₹].*\.$/);
          expect(summary, where).not.toMatch(/ {2}| \.|\(\)|\( | \)|,\.|\.\./);
          expect(summary, where).not.toMatch(/\b(?:null|undefined|NaN)\b/);
        }
      }
    });

    it("treats an amount that is not a finite number as missing", () => {
      expect(entry({ amount: Number.NaN }).amount).toBeNull();
      expect(entry({ amount: Number.POSITIVE_INFINITY }).summary).toBe("Logged from Asha for October 2026 (payment 4).");
    });

    it("says the portion is not recorded when its name is blank", () => {
      expect(entry({ portion: "" }).portion).toBe("Portion not recorded");
      expect(entry({ portion: "   " }).portion).toBe("Portion not recorded");
    });
  });

  it("does not change the row it is given", () => {
    const row = item({ action: "Undone" });
    const copy = structuredClone(row);
    toActivityEntry(row, VIEWER);
    expect(row).toEqual(copy);
  });

  it("copes with a row whose texts are odd: very long, with markup, or with line breaks", () => {
    const long = "A".repeat(500);
    const odd = toActivityEntry(
      item({ tenant: `<b>${long}</b>\n`, loggedBy: `${long}@example.com`, portion: "Ground <i>floor</i>" }),
      VIEWER,
    );
    expect(odd.summary).toContain(long);
    expect(odd.portion).toBe("Ground <i>floor</i>");
    expect(odd.meta).toContain(`by ${long}@example.com`);
  });
});

describe("dayHeading", () => {
  it("says Today for today and Yesterday for the day before", () => {
    expect(dayHeading("2026-10-16", "2026-10-16")).toBe("Today");
    expect(dayHeading("2026-10-15", "2026-10-16")).toBe("Yesterday");
  });

  it("finds yesterday across the end of a month, a year and a leap February", () => {
    expect(dayHeading("2026-02-28", "2026-03-01")).toBe("Yesterday");
    expect(dayHeading("2026-12-31", "2027-01-01")).toBe("Yesterday");
    expect(dayHeading("2028-02-29", "2028-03-01")).toBe("Yesterday");
    expect(dayHeading("2028-02-28", "2028-03-01")).toBe("Monday, 28 February");
  });

  it("says the weekday, the day and the month for an earlier day this year", () => {
    expect(dayHeading("2026-10-14", "2026-10-16")).toBe("Wednesday, 14 October");
    expect(dayHeading("2026-01-01", "2026-10-16")).toBe("Thursday, 1 January");
    expect(dayHeading("2026-12-31", "2026-12-31")).toBe("Today");
    expect(dayHeading("2026-03-08", "2026-03-09")).toBe("Yesterday");
  });

  it("says the day, the month and the year for another year, with no weekday", () => {
    expect(dayHeading("2025-10-14", "2026-10-16")).toBe("14 October 2025");
    expect(dayHeading("2027-01-02", "2026-10-16")).toBe("2 January 2027");
    expect(dayHeading("2025-12-31", "2026-01-01")).toBe("Yesterday");
    expect(dayHeading("2025-12-30", "2026-01-01")).toBe("30 December 2025");
  });

  it("does not call a day after today Today or Yesterday", () => {
    expect(dayHeading("2026-10-17", "2026-10-16")).toBe("Saturday, 17 October");
  });

  it("writes the year when it does not know today", () => {
    expect(dayHeading("2026-10-14", null)).toBe("14 October 2026");
  });

  it("says the date was not recorded for a key that is not a real day", () => {
    for (const key of ["", "unknown", "2026-02-30", "2026-10", "15 Oct"]) {
      expect(dayHeading(key, "2026-10-16"), key).toBe(DATE_NOT_RECORDED);
    }
    expect(DATE_NOT_RECORDED).toBe("Date not recorded");
  });
});

describe("groupByDay", () => {
  // 10:30 am on Friday 16 October in India.
  const NOW = new Date("2026-10-16T05:00:00Z");
  const at = (savedAt: string, extra: Partial<ActivityItem> = {}) => item({ savedAt, ...extra });
  const summary = (groups: ReturnType<typeof groupByDay<ActivityItem>>) =>
    groups.map((group) => [group.key, group.heading, group.entries.map((row) => row.savedAt)]);

  it("is empty for an empty log", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it("puts each India day under its own heading and keeps the newest-first order", () => {
    const rows = [
      at("2026-10-16T04:00:00Z"),
      at("2026-10-16T02:00:00Z"),
      at("2026-10-15T10:00:00Z"),
      at("2026-10-14T10:00:00Z"),
      at("2025-09-01T10:00:00Z"),
    ];
    expect(summary(groupByDay(rows, NOW))).toEqual([
      ["2026-10-16", "Today", ["2026-10-16T04:00:00Z", "2026-10-16T02:00:00Z"]],
      ["2026-10-15", "Yesterday", ["2026-10-15T10:00:00Z"]],
      ["2026-10-14", "Wednesday, 14 October", ["2026-10-14T10:00:00Z"]],
      ["2025-09-01", "1 September 2025", ["2025-09-01T10:00:00Z"]],
    ]);
  });

  it("groups by the day the entry was saved in India, so 19:00 UTC on the 15th is Today on the 16th", () => {
    const groups = groupByDay([at("2026-10-15T19:00:00Z"), at("2026-10-15T18:00:00Z")], NOW);
    expect(summary(groups)).toEqual([
      ["2026-10-16", "Today", ["2026-10-15T19:00:00Z"]],
      ["2026-10-15", "Yesterday", ["2026-10-15T18:00:00Z"]],
    ]);
  });

  it("takes today in India too: just after 18:30 UTC it is already tomorrow there", () => {
    const lateEvening = new Date("2026-10-15T19:00:00Z");
    expect(groupByDay([at("2026-10-15T19:00:00Z")], lateEvening)[0].heading).toBe("Today");
    expect(groupByDay([at("2026-10-15T18:00:00Z")], lateEvening)[0].heading).toBe("Yesterday");
    const justBefore = new Date("2026-10-15T18:00:00Z");
    expect(groupByDay([at("2026-10-15T18:00:00Z")], justBefore)[0].heading).toBe("Today");
  });

  it("does not split a day when the rows of one day are not next to each other", () => {
    // A Payments Log row that was retried is added later than rows saved after it, so the log is not strictly in time order.
    const rows = [at("2026-10-16T04:00:00Z"), at("2026-10-15T10:00:00Z"), at("2026-10-16T01:00:00Z")];
    expect(summary(groupByDay(rows, NOW))).toEqual([
      ["2026-10-16", "Today", ["2026-10-16T04:00:00Z", "2026-10-16T01:00:00Z"]],
      ["2026-10-15", "Yesterday", ["2026-10-15T10:00:00Z"]],
    ]);
  });

  it("puts the newest day first even when a row of an older day is first in the log", () => {
    const rows = [at("2026-10-14T10:00:00Z"), at("2026-10-16T04:00:00Z")];
    expect(groupByDay(rows, NOW).map((group) => group.key)).toEqual(["2026-10-16", "2026-10-14"]);
  });

  it("puts rows whose time cannot be read in a last group, Date not recorded, whatever their place in the log", () => {
    const rows = [
      at("garbage"),
      at("2026-10-16T04:00:00Z"),
      at(""),
      at("2026-10-15T10:00:00Z", { tenant: "Dev" }),
      at("46300.4166"),
    ];
    const groups = groupByDay(rows, NOW);
    expect(groups.map((group) => [group.key, group.heading])).toEqual([
      ["2026-10-16", "Today"],
      ["2026-10-15", "Yesterday"],
      [UNKNOWN_DAY_KEY, "Date not recorded"],
    ]);
    expect(groups[2].entries.map((row) => row.savedAt)).toEqual(["garbage", "", "46300.4166"]);
  });

  it("makes no Date not recorded group when every time can be read", () => {
    expect(groupByDay([at("2026-10-16T04:00:00Z")], NOW).map((group) => group.key)).not.toContain(UNKNOWN_DAY_KEY);
  });

  it("makes only the Date not recorded group when no time can be read", () => {
    const groups = groupByDay([at("x"), at("y")], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: UNKNOWN_DAY_KEY, heading: "Date not recorded" });
    expect(groups[0].entries).toHaveLength(2);
  });

  it("does not call anything Today when the clock is unreadable", () => {
    const groups = groupByDay([at("2026-10-16T04:00:00Z")], new Date(Number.NaN));
    expect(groups[0].heading).toBe("16 October 2026");
  });

  it("does not change the list it is given", () => {
    const rows = [at("2026-10-14T10:00:00Z"), at("2026-10-16T04:00:00Z")];
    const copy = [...rows];
    groupByDay(rows, NOW);
    expect(rows).toEqual(copy);
  });

  it("holds the very rows it was given, so a screen can show each one", () => {
    const row = at("2026-10-16T04:00:00Z");
    expect(groupByDay([row], NOW)[0].entries[0]).toBe(row);
  });

  it("groups the entries of a mixed-up log of 5,000 rows without losing or doubling one, reading each row's time once", () => {
    // 5,000 rows over 625 days, newest first, with some that cannot be read and two saved out of order.
    const rows = Array.from({ length: 5000 }, (_, index) =>
      at(index % 97 === 0 ? "n/a" : new Date(Date.UTC(2026, 9, 16, 5, 0, 0) - index * 3 * 3_600_000).toISOString(), {
        tenant: `Tenant ${index}`,
      }),
    );
    [rows[10], rows[200]] = [rows[200], rows[10]];
    // The work is counted, not timed: one read of each row's saved time is the least it can take, so no pass is repeated per row.
    let reads = 0;
    const counted = rows.map((row) => {
      const copy = { ...row };
      Object.defineProperty(copy, "savedAt", { get: () => (reads++, row.savedAt) });
      return copy;
    });
    const groups = groupByDay(counted, NOW);
    expect(reads).toBe(rows.length);
    expect(groups.flatMap((group) => group.entries)).toHaveLength(rows.length);
    expect(new Set(groups.flatMap((group) => group.entries.map((row) => row.tenant))).size).toBe(rows.length);
    const keys = groups.map((group) => group.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.at(-1)).toBe(UNKNOWN_DAY_KEY);
    expect(keys.slice(0, -1)).toEqual([...keys.slice(0, -1)].sort().reverse());
    expect(groups[0]).toMatchObject({ key: "2026-10-16", heading: "Today" });
  });
});

describe("portionsIn", () => {
  it("lists each portion name once, in the order they are first seen", () => {
    const rows = [
      item({ portion: "First floor" }),
      item({ portion: "Ground floor" }),
      item({ portion: "First floor" }),
      item({ portion: "Attic" }),
      item({ portion: "Ground floor" }),
    ];
    expect(portionsIn(rows)).toEqual(["First floor", "Ground floor", "Attic"]);
  });

  it("is empty for an empty log, and leaves out a blank name", () => {
    expect(portionsIn([])).toEqual([]);
    expect(portionsIn([item({ portion: "" }), item({ portion: "   " }), item({ portion: "Attic" })])).toEqual(["Attic"]);
  });

  it("tells names apart by their exact text", () => {
    expect(portionsIn([item({ portion: "Attic" }), item({ portion: "attic" })])).toEqual(["Attic", "attic"]);
  });
});

describe("parseActivityFilters", () => {
  const ALL: ActivityFilters = { show: "all", portion: null };

  it("shows everything when there is nothing to go by", () => {
    expect(parseActivityFilters({})).toEqual(ALL);
    expect(parseActivityFilters(undefined)).toEqual(ALL);
    expect(parseActivityFilters({ month: "2026-10" })).toEqual(ALL);
  });

  it("reads each kind of entry", () => {
    expect(parseActivityFilters({ show: "logged" })).toEqual({ show: "logged", portion: null });
    expect(parseActivityFilters({ show: "edited" })).toEqual({ show: "edited", portion: null });
    expect(parseActivityFilters({ show: "undone" })).toEqual({ show: "undone", portion: null });
    expect(parseActivityFilters({ show: "all" })).toEqual(ALL);
  });

  it("falls back to all for a value it does not know", () => {
    for (const show of ["deleted", "", "LOGGED", "changed", "logged,undone", "__proto__", "constructor"]) {
      expect(parseActivityFilters({ show }), show).toEqual(ALL);
    }
  });

  it("reads a portion name as it is written", () => {
    expect(parseActivityFilters({ portion: "First floor, single bedroom" })).toEqual({
      show: "all",
      portion: "First floor, single bedroom",
    });
    expect(parseActivityFilters({ portion: " Attic " }).portion).toBe(" Attic ");
  });

  it("takes a blank portion as no portion", () => {
    expect(parseActivityFilters({ portion: "" }).portion).toBeNull();
    expect(parseActivityFilters({ portion: "   " }).portion).toBeNull();
  });

  it("takes the first when a name is given twice", () => {
    expect(parseActivityFilters({ show: ["undone", "logged"], portion: ["Attic", "Shop"] })).toEqual({
      show: "undone",
      portion: "Attic",
    });
    expect(parseActivityFilters({ show: [], portion: [] })).toEqual(ALL);
  });

  it("reads show and portion together", () => {
    expect(parseActivityFilters({ show: "undone", portion: "Attic", month: "2026-10" })).toEqual({
      show: "undone",
      portion: "Attic",
    });
  });

  it("ignores a value that is undefined", () => {
    expect(parseActivityFilters({ show: undefined, portion: undefined })).toEqual(ALL);
  });
});

describe("withKnownPortion", () => {
  const portions = ["Ground floor", "First floor"];

  it("keeps a portion that is in the log", () => {
    expect(withKnownPortion({ show: "undone", portion: "First floor" }, portions)).toEqual({ show: "undone", portion: "First floor" });
  });

  it("falls back to all portions for a name that is not in the log, as a kind of entry it does not know falls back to all", () => {
    expect(withKnownPortion({ show: "undone", portion: "Nowhere" }, portions)).toEqual({ show: "undone", portion: null });
    expect(withKnownPortion({ show: "all", portion: "first floor" }, portions)).toEqual({ show: "all", portion: null });
    expect(withKnownPortion({ show: "all", portion: "Anything" }, [])).toEqual({ show: "all", portion: null });
  });

  it("leaves no portion as no portion, and does not change what it is given", () => {
    const filters = { show: "logged" as const, portion: "Gone" };
    expect(withKnownPortion({ show: "logged", portion: null }, portions)).toEqual({ show: "logged", portion: null });
    withKnownPortion(filters, portions);
    expect(filters).toEqual({ show: "logged", portion: "Gone" });
  });
});

describe("filterActivity", () => {
  const rows = [
    item({ action: "Undone", portion: "Attic", tenant: "1" }),
    item({ action: "Logged", portion: "Ground floor", tenant: "2" }),
    item({ action: "Edited", portion: "Attic", tenant: "3" }),
    item({ action: null, portion: "Attic", tenant: "4" }),
    item({ action: "Logged", portion: "Attic", tenant: "5" }),
  ];
  const tenants = (filters: ActivityFilters) => filterActivity(rows, filters).map((row) => row.tenant);

  it("keeps everything, old rows included, when the filters are off, and keeps the order", () => {
    expect(tenants({ show: "all", portion: null })).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("keeps one kind of entry", () => {
    expect(tenants({ show: "logged", portion: null })).toEqual(["2", "5"]);
    expect(tenants({ show: "edited", portion: null })).toEqual(["3"]);
    expect(tenants({ show: "undone", portion: null })).toEqual(["1"]);
  });

  it("keeps one portion, an older row included", () => {
    expect(tenants({ show: "all", portion: "Attic" })).toEqual(["1", "3", "4", "5"]);
    expect(tenants({ show: "all", portion: "Ground floor" })).toEqual(["2"]);
  });

  it("keeps what matches both", () => {
    expect(tenants({ show: "logged", portion: "Attic" })).toEqual(["5"]);
    expect(tenants({ show: "undone", portion: "Ground floor" })).toEqual([]);
  });

  it("matches a portion by its exact name, and finds nothing for a name that is not there", () => {
    expect(tenants({ show: "all", portion: "attic" })).toEqual([]);
    expect(tenants({ show: "all", portion: "Cellar" })).toEqual([]);
  });

  it("does not change the list it is given, and gives an empty list for an empty log", () => {
    const copy = structuredClone(rows);
    filterActivity(rows, { show: "logged", portion: null });
    expect(rows).toEqual(copy);
    expect(filterActivity([], { show: "undone", portion: "Attic" })).toEqual([]);
  });
});

describe("activityHref", () => {
  it("is the plain Activity address for no filters and no month", () => {
    expect(activityHref({ show: "all", portion: null }, null)).toBe("/activity");
    expect(activityHref({ show: "all", portion: null }, undefined)).toBe("/activity");
  });

  it("keeps the month, so the tab bar and the way back still lead to it", () => {
    expect(activityHref({ show: "all", portion: null }, "2026-10")).toBe("/activity?month=2026-10");
  });

  it("drops a month that is not one", () => {
    expect(activityHref({ show: "all", portion: null }, "garbage")).toBe("/activity");
  });

  it("names a kind of entry, and leaves out the default", () => {
    expect(activityHref({ show: "undone", portion: null }, null)).toBe("/activity?show=undone");
    expect(activityHref({ show: "edited", portion: null }, "2026-10")).toBe("/activity?show=edited&month=2026-10");
    expect(activityHref({ show: "all", portion: null }, null)).not.toContain("show");
  });

  it("names a portion, written so that an address can hold it", () => {
    expect(activityHref({ show: "all", portion: "First floor, single bedroom" }, null)).toBe(
      "/activity?portion=First+floor%2C+single+bedroom",
    );
    const href = activityHref({ show: "logged", portion: "Attic & loft = 100%" }, "2026-10");
    const params = new URL(href, "http://localhost").searchParams;
    expect([params.get("show"), params.get("portion"), params.get("month")]).toEqual(["logged", "Attic & loft = 100%", "2026-10"]);
  });

  it("is read back as the same filters, for every kind of entry and a name with marks in it", () => {
    const names = ["Ground floor", "First floor, single bedroom", "Attic & loft = 100%", "Café – rear ₹", " padded ", "a+b", "#1"];
    for (const show of ["all", "logged", "edited", "undone"] as const) {
      for (const portion of [null, ...names]) {
        const filters: ActivityFilters = { show, portion };
        const params = new URL(activityHref(filters, "2026-10"), "http://localhost").searchParams;
        const read = parseActivityFilters(Object.fromEntries(params));
        expect(read, JSON.stringify(filters)).toEqual(filters);
      }
    }
  });
});

describe("the whole log, as the screen reads it", () => {
  it("filters every row of a long log, shows the newest 50 and groups only those, in order", () => {
    const LOG = 2000;
    const portions = ["Ground floor", "First floor", "Attic", "Shop"];
    const actions: ActivityItem["action"][] = ["Logged", "Logged", "Edited", "Undone", null];
    const rows = Array.from({ length: LOG }, (_, index) =>
      item({
        savedAt: new Date(Date.UTC(2026, 9, 16, 5, 0, 0) - index * 7_200_000).toISOString(),
        portion: portions[index % portions.length],
        action: actions[index % actions.length],
        tenant: `Tenant ${index}`,
      }),
    );
    const names = portionsIn(rows);
    const matching = filterActivity(rows, { show: "all", portion: "Attic" });
    const shown = matching.slice(0, ACTIVITY_SHOWN_LIMIT);
    // Only the rows that are shown are dated and written out (the saved time is read once to group a row and once to write
    // its time), so that work does not grow with the log; only the filter does.
    let reads = 0;
    const counted = shown.map((row) => {
      const copy = { ...row };
      Object.defineProperty(copy, "savedAt", { get: () => (reads++, row.savedAt) });
      return copy;
    });
    const days = groupByDay(counted, new Date("2026-10-16T05:00:00Z")).map((group) => ({
      ...group,
      entries: group.entries.map((row) => toActivityEntry(row, VIEWER)),
    }));

    expect(reads).toBe(2 * ACTIVITY_SHOWN_LIMIT);
    expect(names).toEqual(portions);
    expect(matching).toHaveLength(LOG / portions.length);
    expect(shown).toHaveLength(ACTIVITY_SHOWN_LIMIT);
    expect(shown.map((row) => row.tenant)).toEqual(matching.slice(0, 50).map((row) => row.tenant));
    expect(days.reduce((sum, group) => sum + group.entries.length, 0)).toBe(ACTIVITY_SHOWN_LIMIT);
    expect(days[0].heading).toBe("Today");
  });

  it("copes with an empty log", () => {
    expect(portionsIn([])).toEqual([]);
    expect(filterActivity([], { show: "all", portion: null })).toEqual([]);
    expect(groupByDay([], new Date("2026-10-16T05:00:00Z"))).toEqual([]);
  });
});
