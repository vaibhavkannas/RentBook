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
  /** Only for a to-do check of one of the app's tabs: what Prepare my Sheet does about it, add the tab or fill in a tab that is there but empty. */
  prepare?: "create" | "fill";
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

/** "A", "A and B", "A, B and C": names in a sentence. */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The advice for a tab setting (SETTINGS_TAB, LOG_TAB, TENANTS_TAB) that names a tab that is not in the Sheet yet: the owner's
 * own tab has to be renamed in the Sheet first, or the app starts a new one. `settings` are the settings as they are to be
 * said ("TENANTS_TAB", or `LOG_TAB ("My Log")`), and `ending` is what follows "rename it in your Sheet first": punctuation, or
 * what the page does about it. One wording for the Set up checks, the Prepare card and Diagnostics.
 */
export function renameFirstAdvice(settings: readonly string[], ending: string): string {
  const one = settings.length === 1;
  return `${listWords(settings)} ${one ? "names a tab that is" : "name tabs that are"} not in your Sheet yet. If you already have ${one ? "it" : "them"} under ${one ? "another name" : "other names"}, rename ${one ? "it" : "them"} in your Sheet first${ending}`;
}
