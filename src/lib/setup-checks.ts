import { BRAND } from "@/lib/brand";
import type { PillTone } from "@/lib/ui-classes";

/**
 * The words and the rules the Set up page and Diagnostics share: what a check is, the six steps, how a step's status
 * comes from its checks, the headline over the page and the pill each status wears. Pure on purpose, so a client
 * component can import it and a test can read it. The checks themselves are made elsewhere (the environment in
 * src/lib/server/setup-env.ts, the Sheet in src/lib/sheets/sheet-checks.ts), and never carry a secret or tenant data.
 */

/** ok: fine. warn: works, but worth a look. fail: needs fixing. todo: not done yet, and the app can do it. skip: waiting for a check before it. */
export type CheckStatus = "ok" | "warn" | "fail" | "todo" | "skip";

export type SetupStep = 1 | 2 | 3 | 4 | 5 | 6;

export type Check = {
  /** Stable, for tests and for finding a check in a list. */
  id: string;
  step: SetupStep;
  title: string;
  status: CheckStatus;
  /** What was found, in words. */
  detail: string;
  /** What to do about it. Only for a warn or a fail. */
  fix?: string;
};

export const SETUP_STEPS: readonly { step: SetupStep; title: string }[] = [
  { step: 1, title: "Sign-in" },
  { step: 2, title: "Google service account" },
  { step: 3, title: "Your Sheet" },
  { step: 4, title: "Schedule tab" },
  { step: 5, title: `${BRAND.name}'s tabs` },
  { step: 6, title: "Portion settings" },
];

/** From the worst to the best: what a step with several checks takes after. */
const WORST_FIRST: readonly CheckStatus[] = ["fail", "warn", "todo", "skip", "ok"];

/** The worst status among the checks of `step`. A step with no checks has nothing wrong with it: ok. */
export function stepStatus(checks: readonly Check[], step: SetupStep): CheckStatus {
  const found = new Set(checks.filter((check) => check.step === step).map((check) => check.status));
  return WORST_FIRST.find((status) => found.has(status)) ?? "ok";
}

/**
 * The sentence over the page. A problem comes first: each fail and each warn is one thing to fix. When there is none
 * and only what the app can do for the person is left (a tab it can create), the Sheet needs preparing. Checks that
 * only wait for another (which a failing check always sits beside) do not count as problems, and are never called a
 * connection.
 */
export function headline(checks: readonly Check[]): string {
  const problems = checks.filter((check) => check.status === "fail" || check.status === "warn").length;
  if (problems > 0) return problems === 1 ? "1 thing to fix." : `${problems} things to fix.`;
  if (checks.some((check) => check.status === "todo")) return "Your Sheet needs preparing.";
  if (checks.some((check) => check.status === "skip")) return "Some checks are waiting.";
  return "Everything is connected.";
}

const PILLS: Record<CheckStatus, { tone: PillTone; label: string }> = {
  ok: { tone: "success", label: "OK" },
  warn: { tone: "warn", label: "Check" },
  fail: { tone: "danger", label: "Fix" },
  todo: { tone: "neutral", label: "To do" },
  skip: { tone: "neutral", label: "Waiting" },
};

/** The tone and the word of the pill that shows a status. */
export function statusPill(status: CheckStatus): { tone: PillTone; label: string } {
  return PILLS[status];
}
