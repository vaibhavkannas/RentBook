import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import { withoutComments } from "../support/source-scan";

// The sheets change the card at once and send the request through the code they always used. They are read for their order
// (the card changes before the request, a failure puts it back, Replace, the far-amount yes, the log retry and the history
// settling all go the way they went) and rendered with the screen's hooks in hand. What each answer means is tested in
// tests/domain/write-flow.test.ts and the card's life in tests/domain/optimistic.test.ts.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import PaymentSheet from "@/components/PaymentSheet";
import UndoSheet from "@/components/UndoSheet";

const read = (name: string) => withoutComments(readFileSync(new URL(`../../src/components/${name}`, import.meta.url), "utf8"));
const writes = { begin: vi.fn(), settle: vi.fn(), rollback: vi.fn(), busy: vi.fn(() => false) };

const pending: PortionCard = {
  portionId: "p1",
  name: "Ground floor",
  cycleLength: 11,
  status: "pending",
  entry: null,
  next: { tenant: "Asha", count: 4, suggestedAmount: 5450, previousAmount: 5450, startsNewCycle: false },
  undoBlockedReason: null,
  tenancy: null,
  rentReference: 5450,
  rentDifference: null,
};
const paid: PortionCard = { ...pending, status: "paid", entry: { tenant: "Asha", count: 4, amount: 5450 }, next: null };

describe("PaymentSheet with the screen's hooks", () => {
  const sheet = read("PaymentSheet.tsx");

  it("changes the card before it sends, and steps aside while the request is on its way", () => {
    const begin = sheet.indexOf("hooks.begin();");
    const park = sheet.indexOf("parking.park();");
    const send = sheet.indexOf('sendJson<PaymentAnswer>("/api/payments", request.body)');
    expect(begin).toBeGreaterThan(-1);
    expect(park).toBeGreaterThan(begin);
    expect(send).toBeGreaterThan(park);
  });

  it("changes the card only after what was typed passed the checks that need no server, the far amount's yes included", () => {
    const refuse = sheet.indexOf("if (!request.ok) return show(fieldProblem(request.message, request.field, known));");
    const far = sheet.indexOf("return setFarAmount(request.body.amount);");
    expect(sheet.indexOf("hooks.begin();")).toBeGreaterThan(refuse);
    expect(sheet.indexOf("hooks.begin();")).toBeGreaterThan(far);
  });

  it("carries every answer out through applyStep, which puts the card back unless the payment was saved", () => {
    expect(sheet).toMatch(/const step = classifyPayment\(sent\);/);
    expect(sheet).toMatch(/applyStep\(step, hooks\)/);
  });

  it("offers Try again on a failure, brings the sheet back with what was typed, and lets it go if the offer is not taken", () => {
    expect(sheet).toMatch(/\{ label: "Try again", onPress: parking\.reopen \}\);\s*return parking\.offerRetry\(\);/);
    expect(read("useParking.ts")).toMatch(/setTimeout\(\(\) => discard\.current\(\), ACTION_TOAST_MS \+ 1000\)/);
  });

  it("brings the sheet back for a duplicate (Replace is checked against the entry the warning named), a field the server refused, and a notice", () => {
    expect(sheet).toMatch(/if \(step\.kind === "duplicate"\) return setConflict\(step\.entry\);/);
    expect(sheet).toMatch(/onClick=\{\(\) => submit\(true\)\}/);
    expect(sheet).toMatch(/seenEntry: seenEntry \?\? \(overwrite \? \(conflict \?\? undefined\) : undefined\)/);
    expect(sheet).toMatch(/setNotice\(\{ retryToken: outcome\.retryToken, tenancyNotSaved: outcome\.tenancyNotSaved \}\);\s*return parking\.reopen\(\);/);
  });

  it("keeps the log retry, the history settling and the far amount's yes as they were", () => {
    expect(sheet).toMatch(/sendJson<ApiBody>\("\/api\/payments\/log-retry", \{ token: notice\.retryToken \}\)/);
    expect(sheet).toMatch(/void settleHistory\(body\)\.then\(\(ok\) => ok \|\| toast\.show\(HISTORY_NOT_SAVED\)\)/);
    expect(sheet).toMatch(/onClick=\{\(\) => submit\(false, true\)\}/);
  });

  it("offers Undo on the toast of a payment that was logged, and of no other", () => {
    expect(sheet).toMatch(/mode === "log" && onUndo \? \{ label: "Undo", onPress: \(\) => onUndo\(portionId\) \} : undefined/);
  });

  it("works without the hooks: then it changes nothing on the screen and waits for the answer, as it always did", () => {
    expect(sheet).toMatch(/const change: Change \| null = writes\s*\?/);
    expect(sheet).toMatch(/if \(change \|\| step\.kind === "saved" \|\| step\.kind === "stale"\) applyStep\(step, hooks\);/);
  });

  it("is on the screen when it is opened, hooks or not", () => {
    const props = { mode: "log" as const, monthKey: "2026-10", monthLabel: "October 2026", cards: [pending], initialPortionId: "p1", defaultDate: "2026-10-05", onClose: () => {} };
    const without = renderToStaticMarkup(createElement(PaymentSheet, props));
    const withHooks = renderToStaticMarkup(createElement(PaymentSheet, { ...props, writes }));
    expect(withHooks).toBe(without);
    expect(without).toContain('role="dialog"');
  });
});

describe("UndoSheet with the screen's hooks", () => {
  const sheet = read("UndoSheet.tsx");

  it("turns the card pending before it sends, and steps aside while the request is on its way", () => {
    const begin = sheet.indexOf("hooks.begin();");
    const park = sheet.indexOf("parking.park();");
    const send = sheet.indexOf('sendJson<ApiBody>("/api/payments/undo"');
    expect(begin).toBeGreaterThan(-1);
    expect(park).toBeGreaterThan(begin);
    expect(send).toBeGreaterThan(park);
  });

  it("still sends what the person was shown, so the undo guard holds", () => {
    expect(sheet).toMatch(/expected: entry,/);
    expect(sheet).toMatch(/const entry = card\.entry!;/);
  });

  it("puts the card back when the Sheet has changed, and says so in the sheet, not in a toast", () => {
    expect(sheet).toMatch(/if \(step\.kind === "conflict"\) \{\s*parking\.reopen\(\);\s*return setConflicted\(true\);/);
  });

  it("offers Try again on a failure, and brings the sheet back with the Retry log entry notice when the entry did not save", () => {
    expect(sheet).toMatch(/\{ label: "Try again", onPress: parking\.reopen \}\);\s*return parking\.offerRetry\(\);/);
    expect(sheet).toMatch(/if \(body\.logWritten === false\) \{\s*parking\.reopen\(\);/);
  });

  it("is on the screen when it is opened, hooks or not", () => {
    const props = { monthKey: "2026-10", monthLabel: "October 2026", card: paid, onClose: () => {} };
    const without = renderToStaticMarkup(createElement(UndoSheet, props));
    expect(renderToStaticMarkup(createElement(UndoSheet, { ...props, writes }))).toBe(without);
    expect(without).toContain("Undo payment?");
  });
});

describe("the month screen", () => {
  const screen = read("MonthScreen.tsx");

  it("gives both sheets the same hooks and keeps them out of the keyed month, so a sheet outlives a switch of month", () => {
    expect(screen.match(/writes=\{writes\}/g)).toHaveLength(2);
    expect(screen.indexOf('className="month-in"')).toBeLessThan(screen.indexOf("<UndoSheet"));
    // the sheets are drawn after the keyed month's div has closed
    const keyed = screen.slice(screen.indexOf('className="month-in"'), screen.indexOf("<UndoSheet"));
    expect(keyed).toContain("</div>");
  });

  it("starts every sheet anew, so one that was let go cannot come back with its old text", () => {
    expect(screen).toMatch(/key=\{`\$\{active\.nonce\}-/);
  });

  it("shows the change on the cards and the summary from one overlay, and drops it when the server's data arrives", () => {
    expect(screen).toMatch(/liveOverlay\(overlay, views\)/);
    expect(screen).toMatch(/applyOverlay\(shownView, live, shownKey\)/);
  });
});

describe("a save answered after its sheet is gone", () => {
  it("tells the owner outside the sheet, in both sheets, and does not start a second change to a portion that is being saved", () => {
    for (const name of ["PaymentSheet.tsx", "UndoSheet.tsx"]) {
      const code = read(name);
      expect(code, name).toMatch(/const alive = useRef\(true\)/);
      expect(code, name).toMatch(/if \(!alive\.current && step\.kind !== "saved"\) \{\s*return publishAway\(/);
      expect(code, name).toMatch(/writes\?\.busy\(monthKey, /);
      // when the request may have saved, the words say check first, so a look at the Sheet is offered and not a second try
      expect(code, name).toMatch(/step\.refresh \? \{ label: "Check", onPress: hooks\.refresh \} : \{ label: "Try again"/);
    }
    expect(read("PaymentSheet.tsx")).toMatch(/if \(!alive\.current\) return publishAway\(paymentOutcomeAway\(step/);
    expect(read("UndoSheet.tsx")).toMatch(/body\.logWritten === false && !alive\.current/);
  });

  it("closes only the sheet that asks, and the notices live in the root layout, which no screen change unmounts", () => {
    expect(read("MonthScreen.tsx")).toMatch(/onClose=\{\(\) => closeSheet\(active\.nonce\)\}/);
    expect(read("MonthScreen.tsx")).toMatch(/closeIfCurrent\(now, nonce\)/);
    const layout = withoutComments(readFileSync(new URL("../../src/app/layout.tsx", import.meta.url), "utf8"));
    expect(layout).toContain("<WriteNotices />");
    expect(read("WriteNotices.tsx")).toMatch(/sendJson<LogRetryResponse>\("\/api\/payments\/log-retry", \{ token \}\)/);
  });
});
