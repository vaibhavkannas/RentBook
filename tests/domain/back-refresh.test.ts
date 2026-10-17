import { beforeEach, describe, expect, it } from "vitest";
import { hrefPath } from "@/lib/app-nav";
import { BACK_REFRESH_MAX_AGE_MS, backRefreshStep, expectBack, takeBackRefresh } from "@/lib/back-refresh";

// Going back in the history shows the screen the browser kept, however old it is, so a month that someone else has
// changed since looks as it did. After a tap that goes back, the screen it lands on is loaded again, once.

describe("hrefPath", () => {
  it("is the path of an address, without its query, and without a trailing slash", () => {
    expect(hrefPath("/?month=2026-10")).toBe("/");
    expect(hrefPath("/more/?month=2026-10")).toBe("/more");
    expect(hrefPath("/tenants/first%20floor%2F2?month=2026-10&changed=1")).toBe("/tenants/first%20floor%2F2");
    expect(hrefPath("https://rentbook.example.com/activity")).toBe("/activity");
  });
});

describe("backRefreshStep", () => {
  const target = { path: "/", at: 1_000 };

  it("does nothing when no back was asked for", () => {
    expect(backRefreshStep(null, "/", 1_001)).toBe("none");
  });

  it("refreshes when the screen the back was heading for is showing", () => {
    expect(backRefreshStep(target, "/", 1_001)).toBe("refresh");
    expect(backRefreshStep({ path: "/more", at: 1_000 }, "/more", 1_500)).toBe("refresh");
    expect(backRefreshStep({ path: "/more", at: 1_000 }, "/more/", 1_500)).toBe("refresh");
  });

  it("waits while another screen is showing, because the traversal has not arrived yet", () => {
    expect(backRefreshStep(target, "/tenants/p1", 1_001)).toBe("wait");
    expect(backRefreshStep({ path: "/activity", at: 1_000 }, "/", 1_001)).toBe("wait");
  });

  it("gives up after ten seconds, so a back that never arrived cannot refresh some later screen", () => {
    expect(BACK_REFRESH_MAX_AGE_MS).toBe(10_000);
    expect(backRefreshStep(target, "/", 1_000 + BACK_REFRESH_MAX_AGE_MS)).toBe("refresh");
    expect(backRefreshStep(target, "/", 1_000 + BACK_REFRESH_MAX_AGE_MS + 1)).toBe("drop");
    expect(backRefreshStep(target, "/tenants/p1", 1_000 + BACK_REFRESH_MAX_AGE_MS + 1)).toBe("drop");
  });
});

describe("expectBack and takeBackRefresh", () => {
  beforeEach(() => {
    // whatever an earlier test left: a long time later, the old target is dropped
    takeBackRefresh("/never", Date.now() + 10 * BACK_REFRESH_MAX_AGE_MS);
  });

  it("says yes once, when the screen the tap was going back to is showing", () => {
    expectBack("/?month=2026-10", 1_000);
    expect(takeBackRefresh("/", 1_100)).toBe(true);
    expect(takeBackRefresh("/", 1_200)).toBe(false);
  });

  it("says no until that screen shows, and keeps the wish meanwhile", () => {
    expectBack("/more?month=2026-10", 1_000);
    expect(takeBackRefresh("/settings", 1_100)).toBe(false);
    expect(takeBackRefresh("/more", 1_200)).toBe(true);
  });

  it("says no when nothing was asked for, so a screen that was not reached by going back is not loaded again", () => {
    expect(takeBackRefresh("/", 1_000)).toBe(false);
  });

  it("forgets a wish that is too old, and does not act on it later", () => {
    expectBack("/", 1_000);
    expect(takeBackRefresh("/", 1_000 + BACK_REFRESH_MAX_AGE_MS + 1)).toBe(false);
    expect(takeBackRefresh("/", 1_000 + BACK_REFRESH_MAX_AGE_MS + 2)).toBe(false);
  });

  it("follows the latest tap: a second back replaces the first", () => {
    expectBack("/", 1_000);
    expectBack("/more", 1_100);
    expect(takeBackRefresh("/", 1_200)).toBe(false);
    expect(takeBackRefresh("/more", 1_300)).toBe(true);
  });

  it("cannot loop: the refresh it asks for does not ask for another", () => {
    expectBack("/", 1_000);
    let refreshes = 0;
    // the screen shows, the effect runs, asks, refreshes; the refresh re-renders the same screen, and the effect runs again
    for (let render = 0; render < 5; render++) if (takeBackRefresh("/", 1_100 + render)) refreshes += 1;
    expect(refreshes).toBe(1);
  });
});
