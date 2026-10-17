import { describe, expect, it } from "vitest";
import {
  monthParam,
  monthScreenHref,
  navAction,
  previousEntryUrl,
  TABS,
  tabForPath,
  withMonth,
} from "@/lib/app-nav";

// The rules of the tab bar and the back arrows: which month an address carries, which tab a screen belongs to, and
// whether a tap on a tab or a back arrow should go back, push, replace or do nothing, so the history stays "the month
// screen, and one other screen" and Back always returns to the month that was showing.

const ORIGIN = "https://rentbook.example.com";

describe("monthParam", () => {
  it("is the month when it is a valid YYYY-MM, and null for anything else", () => {
    expect(monthParam("2026-10")).toBe("2026-10");
    expect(monthParam("1999-01")).toBe("1999-01");
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", "", " 2026-10", "october", "2026/10"]) {
      expect(monthParam(bad), bad).toBeNull();
    }
    expect(monthParam(null)).toBeNull();
    expect(monthParam(undefined)).toBeNull();
  });

  it("takes the first when the address repeats the month", () => {
    expect(monthParam(["2026-09", "2026-10"])).toBe("2026-09");
    expect(monthParam(["nope", "2026-10"])).toBeNull();
    expect(monthParam([])).toBeNull();
  });
});

describe("withMonth", () => {
  it("adds the month to a path", () => {
    expect(withMonth("/activity", "2026-10")).toBe("/activity?month=2026-10");
    expect(withMonth("/", "2026-10")).toBe("/?month=2026-10");
    expect(withMonth("/tenants/p1", "2026-09")).toBe("/tenants/p1?month=2026-09");
  });

  it("replaces a month the path already has, where it stands", () => {
    expect(withMonth("/?month=2026-09", "2026-10")).toBe("/?month=2026-10");
    expect(withMonth("/tenants/p1?month=2026-09&changed=1", "2026-10")).toBe("/tenants/p1?month=2026-10&changed=1");
  });

  it("keeps the other parts of the address", () => {
    expect(withMonth("/tenants/p1?changed=1", "2026-10")).toBe("/tenants/p1?changed=1&month=2026-10");
    expect(withMonth("/tenants/first%20floor%2F2", "2026-10")).toBe("/tenants/first%20floor%2F2?month=2026-10");
  });

  it("leaves the path as it is when there is no month, or the month is not a month", () => {
    expect(withMonth("/activity", null)).toBe("/activity");
    expect(withMonth("/activity", undefined)).toBe("/activity");
    expect(withMonth("/activity?x=1", null)).toBe("/activity?x=1");
    expect(withMonth("/activity", "nope")).toBe("/activity");
  });
});

describe("monthScreenHref", () => {
  it("is the month screen of that month, or plain / without one", () => {
    expect(monthScreenHref("2026-10")).toBe("/?month=2026-10");
    expect(monthScreenHref(null)).toBe("/");
    expect(monthScreenHref(undefined)).toBe("/");
    expect(monthScreenHref("garbage")).toBe("/");
  });
});

describe("TABS", () => {
  it("are Month, Activity and More, in that order, each with its address", () => {
    expect(TABS).toEqual([
      { id: "month", label: "Month", path: "/" },
      { id: "activity", label: "Activity", path: "/activity" },
      { id: "more", label: "More", path: "/more" },
    ]);
  });
});

describe("tabForPath", () => {
  it("puts the month screen and the tenant pages under Month", () => {
    expect(tabForPath("/")).toBe("month");
    expect(tabForPath("/tenants/p1")).toBe("month");
    expect(tabForPath("/tenants/first%20floor%2F2")).toBe("month");
  });

  it("puts Activity under Activity", () => {
    expect(tabForPath("/activity")).toBe("activity");
  });

  it("puts More and the settings page under More", () => {
    expect(tabForPath("/more")).toBe("more");
    expect(tabForPath("/settings")).toBe("more");
  });

  it("puts nothing else under any tab, so the bar is not shown on the sign-in page or a page that was not found", () => {
    for (const other of ["/signin", "/no-such-page", "/tenants", "/tenants/", "/activity/extra", "/morex", "/settings/x", "/api/health"]) {
      expect(tabForPath(other), other).toBeNull();
    }
    expect(tabForPath(null)).toBeNull();
    expect(tabForPath(undefined)).toBeNull();
    expect(tabForPath("")).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(tabForPath("/more/")).toBe("more");
    expect(tabForPath("/activity/")).toBe("activity");
  });
});

describe("navAction", () => {
  const action = (fromPath: string, to: string, previousUrl: string | null, currentKey?: string | null) =>
    navAction({ fromPath, to, previousUrl, currentKey });

  describe("when the person is already on the target's root", () => {
    it("does nothing (the tab only scrolls to the top)", () => {
      expect(action("/", "/?month=2026-10", null)).toBe("none");
      expect(action("/activity", "/activity?month=2026-10", `${ORIGIN}/`)).toBe("none");
      expect(action("/more", "/more", `${ORIGIN}/more`)).toBe("none");
    });

    it("does nothing even when the previous entry is the target", () => {
      expect(action("/", "/", `${ORIGIN}/`)).toBe("none");
    });
  });

  describe("when the previous history entry is the target's root, with the same month", () => {
    it("goes back, so the month that was showing is the one that comes back", () => {
      expect(action("/tenants/p1", "/?month=2026-10", `${ORIGIN}/?month=2026-10`)).toBe("back");
      expect(action("/activity", "/", `${ORIGIN}/`)).toBe("back");
      expect(action("/settings", "/more", `${ORIGIN}/more`)).toBe("back");
      expect(action("/settings", "/more?month=2026-10", `${ORIGIN}/more?month=2026-10`)).toBe("back");
    });

    it("goes back to the month screen from any other screen, including More", () => {
      expect(action("/more", "/?month=2026-09", `${ORIGIN}/?month=2026-09`)).toBe("back");
    });

    it("takes a previous address that is only a path", () => {
      expect(action("/tenants/p1", "/?month=2026-10", "/?month=2026-10")).toBe("back");
    });
  });

  describe("when the previous entry is the target's root, but of another month", () => {
    it("does not go back, because that would show the wrong month: it replaces with the month it carries", () => {
      expect(action("/tenants/p1", "/?month=2026-10", `${ORIGIN}/?month=2026-09`)).toBe("replace");
      expect(action("/tenants/p1", "/?month=2026-10", `${ORIGIN}/`)).toBe("replace");
      expect(action("/tenants/p1", "/", `${ORIGIN}/?month=2026-09`)).toBe("replace");
    });

    it("counts a month that is not a month as no month", () => {
      expect(action("/tenants/p1", "/", `${ORIGIN}/?month=garbage`)).toBe("back");
    });
  });

  describe("when the current month is known", () => {
    it("treats the current month and no month as the same month, because the app leaves it out of the address", () => {
      expect(action("/tenants/p1", "/?month=2026-10", `${ORIGIN}/`, "2026-10")).toBe("back");
      expect(action("/tenants/p1", "/", `${ORIGIN}/?month=2026-10`, "2026-10")).toBe("back");
      expect(action("/tenants/p1", "/?month=2026-10", `${ORIGIN}/?month=2026-10`, "2026-10")).toBe("back");
    });

    it("still tells another month from the current one", () => {
      expect(action("/tenants/p1", "/?month=2026-09", `${ORIGIN}/`, "2026-10")).toBe("replace");
      expect(action("/tenants/p1", "/", `${ORIGIN}/?month=2026-09`, "2026-10")).toBe("replace");
    });

    it("does not guess when the current month is not known", () => {
      expect(action("/tenants/p1", "/?month=2026-10", `${ORIGIN}/`, null)).toBe("replace");
      expect(action("/tenants/p1", "/?month=2026-10", `${ORIGIN}/`, undefined)).toBe("replace");
    });
  });

  describe("when there is no previous entry to read (the browser has no Navigation API)", () => {
    it("replaces the current screen with the target, with its month, so Back does not step through screens", () => {
      expect(action("/tenants/p1", "/?month=2026-10", null)).toBe("replace");
      expect(action("/activity", "/more?month=2026-10", null)).toBe("replace");
      expect(action("/settings", "/more", null)).toBe("replace");
    });

    it("still pushes when the person leaves the month screen", () => {
      expect(action("/", "/activity?month=2026-10", null)).toBe("push");
    });
  });

  describe("when the person leaves the month screen", () => {
    it("pushes, so Back returns to it", () => {
      expect(action("/", "/activity?month=2026-10", `${ORIGIN}/signin`)).toBe("push");
      expect(action("/", "/more", `${ORIGIN}/?month=2026-09`)).toBe("push");
      expect(action("/", "/tenants/p1?month=2026-10", `${ORIGIN}/`)).toBe("push");
    });
  });

  describe("otherwise", () => {
    it("replaces, so the history stays the month screen and one other screen", () => {
      expect(action("/activity", "/more?month=2026-10", `${ORIGIN}/?month=2026-10`)).toBe("replace");
      expect(action("/more", "/activity", `${ORIGIN}/`)).toBe("replace");
      expect(action("/settings", "/activity", `${ORIGIN}/more`)).toBe("replace");
    });

    it("replaces from a tenant page, which is not the month screen, instead of pushing a third entry", () => {
      expect(action("/tenants/p1", "/activity?month=2026-10", `${ORIGIN}/?month=2026-10`)).toBe("replace");
      expect(action("/tenants/p1", "/more", `${ORIGIN}/`)).toBe("replace");
    });

    it("replaces when the previous entry is another screen", () => {
      expect(action("/activity", "/?month=2026-10", `${ORIGIN}/signin`)).toBe("replace");
    });
  });

  it("ignores a trailing slash on a path", () => {
    expect(action("/more/", "/more", null)).toBe("none");
    expect(action("/settings", "/more", `${ORIGIN}/more/`)).toBe("back");
  });
});

describe("previousEntryUrl", () => {
  const nav = (index: number, urls: (string | null)[]) => ({
    currentEntry: { index },
    entries: () => urls.map((url) => ({ url })),
  });

  it("is the address of the entry before the current one, as the Navigation API lists it", () => {
    expect(previousEntryUrl(nav(2, [`${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/c`]))).toBe(`${ORIGIN}/b`);
    expect(previousEntryUrl(nav(1, [`${ORIGIN}/a`, `${ORIGIN}/b`]))).toBe(`${ORIGIN}/a`);
  });

  it("is null when the current entry is the first", () => {
    expect(previousEntryUrl(nav(0, [`${ORIGIN}/a`]))).toBeNull();
  });

  it("is null where the browser has no Navigation API", () => {
    expect(previousEntryUrl(undefined)).toBeNull();
    expect(previousEntryUrl(null)).toBeNull();
    expect(previousEntryUrl({})).toBeNull();
  });

  it("is null when the API gives nothing usable, and never throws", () => {
    expect(previousEntryUrl({ currentEntry: null, entries: () => [] })).toBeNull();
    expect(previousEntryUrl({ currentEntry: { index: -1 }, entries: () => [] })).toBeNull();
    expect(previousEntryUrl({ currentEntry: { index: 5 }, entries: () => [] })).toBeNull();
    expect(previousEntryUrl(nav(1, [null, `${ORIGIN}/b`]))).toBeNull();
    expect(
      previousEntryUrl({
        currentEntry: { index: 1 },
        entries: () => {
          throw new Error("not allowed");
        },
      }),
    ).toBeNull();
    expect(
      previousEntryUrl({
        get currentEntry(): never {
          throw new Error("not allowed");
        },
        entries: () => [],
      }),
    ).toBeNull();
  });
});
