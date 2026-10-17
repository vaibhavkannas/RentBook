import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withoutComments } from "../support/source-scan";

/**
 * Every write ends in a toast or an inline message, never in silence, and no field can be edited while its save is in
 * flight. This reads the components' source: the copy is tested in tests/domain/toast-copy.test.ts, the toast's timing in
 * tests/domain/toast.test.ts, and what a tap does in a real browser was checked by hand.
 */

const code = (name: string) => withoutComments(readFileSync(new URL(`../../src/components/${name}.tsx`, import.meta.url), "utf8"));

const WRITERS = ["MoveOutForm", "PaymentSheet", "SettingsForm", "TenancyForm", "UndoSheet"];

describe.each(WRITERS)("%s", (name) => {
  it("takes the toast from the provider and shows it with a call to show()", () => {
    expect(code(name)).toMatch(/import \{ useToast \} from "@\/components\/ui\/Toast"/);
    expect(code(name)).toMatch(/const toast = useToast\(\)/);
    expect(code(name)).toMatch(/toast\.show\(/);
  });
});

describe("the words of each toast", () => {
  it("come from toast-copy.ts and undo-copy.ts, not from the components", () => {
    expect(code("PaymentSheet")).toMatch(/import \{[^}]*\bpaymentToasts\b[^}]*\} from "@\/lib\/toast-copy"/);
    expect(code("SettingsForm")).toMatch(/import \{[^}]*\bSETTINGS_SAVED_TOAST\b[^}]*\} from "@\/lib\/toast-copy"/);
    expect(code("TenancyForm")).toMatch(/import \{[^}]*\bDETAILS_SAVED_TOAST\b[^}]*\} from "@\/lib\/toast-copy"/);
    expect(code("MoveOutForm")).toMatch(/import \{[^}]*\bmoveOutToastText\b[^}]*\} from "@\/lib\/toast-copy"/);
    expect(code("UndoSheet")).toMatch(/\bundoExitToastText\b/);
    expect(code("SettingsForm")).toMatch(/toast\.show\(SETTINGS_SAVED_TOAST\)/);
    expect(code("TenancyForm")).toMatch(/toast\.show\(DETAILS_SAVED_TOAST\)/);
    expect(code("MoveOutForm")).toMatch(/toast\.show\(moveOutToastText\(tenant\)\)/);
  });
});

describe("the forms lock while they save", () => {
  it.each(["PaymentSheet", "SettingsForm", "TenancyForm", "MoveOutForm"])("%s puts its fields in a fieldset that is disabled while busy", (name) => {
    expect(code(name)).toMatch(/<fieldset disabled=\{busy\}/);
  });

  it.each(["PaymentSheet", "SettingsForm", "TenancyForm", "MoveOutForm"])("%s has a submit button that shows the pending state", (name) => {
    expect(code(name)).toMatch(/type="submit"[^>]*pending=\{busy\}|pending=\{busy\}[^>]*type="submit"/);
    expect(code(name)).toMatch(/pendingLabel="Saving…"/);
  });

  it("the undo sheet disables Keep while it works, and shows Undoing… on the button", () => {
    expect(code("UndoSheet")).toMatch(/pendingLabel="Undoing…"/);
    expect(code("UndoSheet")).toMatch(/disabled=\{busy\}/);
  });
});

describe("PortionBoard", () => {
  const board = code("PortionBoard");

  it("no longer has a toast of its own: the shared region shows it", () => {
    expect(board).not.toMatch(/role="status"/);
    expect(board).not.toMatch(/setToast|toastCount/);
    expect(board).not.toMatch(/onDone/);
  });
});

describe("SettingsForm", () => {
  it("no longer says Saved inline, but keeps its errors inline", () => {
    const form = code("SettingsForm");
    expect(form).not.toMatch(/"Saved"/);
    expect(form).toMatch(/<Notice tone="danger" role="alert"/);
  });
});

describe("TenancyForm", () => {
  const form = code("TenancyForm");

  it("keeps the create form's status while the page updates, and drops the edit form's green Saved. box", () => {
    expect(form).toMatch(/Saved\. Updating the page…/);
    expect(form).not.toMatch(/"Saved\."/);
    expect(form).not.toMatch(/LiveNotice/);
  });
});

describe("a sheet that stopped on a notice", () => {
  it("shows the payment sheet's toast when the sheet finally closes, after a retry or a skip", () => {
    const sheet = code("PaymentSheet");
    // the toasts are kept while the notice is up, and shown by the one function every way out of the notice goes through
    expect(sheet).toMatch(/const \[doneToasts, setDoneToasts\] = useState<PaymentToasts \| null>\(null\)/);
    expect(sheet).toMatch(/function finishWith\(logEntrySaved: boolean\)\s*\{\s*if \(doneToasts\) toast\.show\(exitToastText\(doneToasts, logEntrySaved\)\);\s*onClose\(\);\s*\}/);
    expect(sheet).toMatch(/onClose=\{finish\}/);
    expect(sheet.match(/onClick=\{finish\}/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("says what is true on the way out: while the Payments Log entry is unsaved (Skip, Close, Escape) the toast says so, and after a successful retry it says logged", () => {
    const sheet = code("PaymentSheet");
    // every way out asks whether the entry is saved from the notice that is showing; a retry that worked says so itself
    expect(sheet).toMatch(/const finish = \(\) => finishWith\(notice\?\.retryToken == null\)/);
    expect(sheet).toMatch(/return finishWith\(true\)/);
    expect(sheet).toMatch(/paymentToasts\(/);
    // the plain "logged" text is never handed to the toast directly while a notice may be up
    expect(sheet).not.toMatch(/setDoneToast\(text\)/);
  });

  it("shows the undo sheet's toast when the undo is done, after a retry or a skip, and when the sheet is closed on the notice", () => {
    const sheet = code("UndoSheet");
    expect(sheet).toMatch(/function done\(logEntrySaved: boolean\)\s*\{\s*toast\.show\(undoExitToastText\(card\.name, logEntrySaved\)\);\s*onClose\(\);\s*\}/);
    expect(sheet).toMatch(/onClose=\{logPending \? \(\) => done\(false\) : onClose\}/);
  });

  it("says what is true on the way out of the undo sheet: saved after the undo and after a retry that worked, unsaved after Skip for now or Escape", () => {
    const sheet = code("UndoSheet");
    // the undo went through and its log entry saved
    expect(sheet).toMatch(/if \(body\.logWritten === false\) return setPendingToken\(body\.retryToken \?\? ""\);\s*return done\(true\);/);
    // a retry that worked
    expect(sheet).toMatch(/if \(body\?\.ok && body\.logWritten\) return done\(true\);/);
    // Skip for now
    expect(sheet).toMatch(/onClick=\{\(\) => done\(false\)\}/);
  });
});
