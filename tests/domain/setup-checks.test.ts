import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import {
  headline,
  SETUP_STEPS,
  statusPill,
  stepStatus,
  type Check,
  type CheckStatus,
  type SetupStep,
} from "@/lib/setup-checks";

// The words and the rules the Set up page and Diagnostics share: the six steps, how a step's status is worked out from
// its checks, the headline over the page, and the pill each status wears.

const check = (status: CheckStatus, step: SetupStep = 1, id = `${status}-${step}`): Check => ({
  id,
  step,
  title: "A check",
  status,
  detail: "What was found.",
  ...(status === "ok" ? {} : { fix: "What to do." }),
});

describe("SETUP_STEPS", () => {
  it("are the six parts of the connection, in order, named for the owner", () => {
    expect(SETUP_STEPS).toEqual([
      { step: 1, title: "Sign-in" },
      { step: 2, title: "Google service account" },
      { step: 3, title: "Your Sheet" },
      { step: 4, title: "Schedule tab" },
      { step: 5, title: `${BRAND.name}'s tabs` },
      { step: 6, title: "Portion settings" },
    ]);
  });
});

describe("stepStatus", () => {
  it("is the worst status among the checks of that step: fail, then warn, then todo, then skip, then ok", () => {
    const order: CheckStatus[] = ["fail", "warn", "todo", "skip", "ok"];
    for (let worse = 0; worse < order.length; worse++) {
      for (let better = worse; better < order.length; better++) {
        const checks = [check(order[better], 2, "a"), check(order[worse], 2, "b"), check("ok", 2, "c")];
        expect(stepStatus(checks, 2), `${order[worse]} beside ${order[better]}`).toBe(order[worse]);
      }
    }
  });

  it("looks only at the checks of its own step", () => {
    const checks = [check("fail", 1), check("ok", 2), check("warn", 3)];
    expect(stepStatus(checks, 1)).toBe("fail");
    expect(stepStatus(checks, 2)).toBe("ok");
    expect(stepStatus(checks, 3)).toBe("warn");
    expect(stepStatus(checks, 4)).toBe("ok");
  });

  it("is ok for a step that has no checks, since nothing was found wrong with it", () => {
    expect(stepStatus([], 5)).toBe("ok");
  });

  it("is waiting for a step whose checks are all waiting", () => {
    expect(stepStatus([check("skip", 4, "a"), check("skip", 4, "b")], 4)).toBe("skip");
  });
});

describe("headline", () => {
  it("says everything is connected when every check is OK", () => {
    expect(headline([check("ok", 1, "a"), check("ok", 3, "b"), check("ok", 6, "c")])).toBe("Everything is connected.");
  });

  it("says the Sheet needs preparing when the only thing left is to do", () => {
    expect(headline([check("ok", 1), check("todo", 5, "a"), check("todo", 5, "b"), check("todo", 6)])).toBe(
      "Your Sheet needs preparing.",
    );
  });

  it("counts the things to fix: each fail and each warn is one", () => {
    expect(headline([check("ok"), check("fail", 2)])).toBe("1 thing to fix.");
    expect(headline([check("ok"), check("warn", 4)])).toBe("1 thing to fix.");
    expect(headline([check("fail", 1, "a"), check("warn", 1, "b"), check("ok", 3)])).toBe("2 things to fix.");
    expect(headline([check("fail", 1, "a"), check("fail", 2, "b"), check("warn", 4, "c"), check("warn", 4, "d")])).toBe(
      "4 things to fix.",
    );
  });

  it("does not count what is to do or waiting as a thing to fix, and puts a problem first", () => {
    expect(headline([check("fail", 3), check("skip", 4, "a"), check("skip", 5, "b"), check("todo", 6)])).toBe("1 thing to fix.");
    expect(headline([check("warn", 1), check("todo", 5)])).toBe("1 thing to fix.");
  });

  it("does not claim a connection while checks are only waiting", () => {
    expect(headline([check("ok", 1), check("skip", 4)])).toBe("Some checks are waiting.");
  });
});

describe("statusPill", () => {
  it.each([
    ["ok", "success", "OK"],
    ["warn", "warn", "Check"],
    ["fail", "danger", "Fix"],
    ["todo", "neutral", "To do"],
    ["skip", "neutral", "Waiting"],
  ] as const)("shows %s as a %s pill that says %s", (status, tone, label) => {
    expect(statusPill(status)).toEqual({ tone, label });
  });
});
