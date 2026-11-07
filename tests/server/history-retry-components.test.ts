import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withoutComments } from "../support/source-scan";

/**
 * The three screens that save tenancy details, and the undo sheet (an undo can open a tenancy again), look at what became of the history after the save: the save's toast shows at once,
 * as it always did, and then settleHistory gets the history in with one automatic retry, and a toast says so only when it
 * cannot. This reads their source: it cannot tap Save, but it finds a screen that forgot to ask.
 */

const read = (name: string) => withoutComments(readFileSync(new URL(`../../src/components/${name}`, import.meta.url), "utf8"));
const SETTLE = /void settleHistory\(\s*(\w+(?:\.\w+)*)\s*\)\s*\.then\(\s*\(ok\)\s*=>\s*ok\s*\|\|\s*toast\.show\(HISTORY_NOT_SAVED\)\s*\)/;

describe.each(["TenancyForm.tsx", "MoveOutForm.tsx", "PaymentSheet.tsx", "UndoSheet.tsx"])("%s", (name) => {
  const code = read(name);

  it("imports settleHistory and the words that say the History is missing the change", () => {
    expect(code).toMatch(/import \{[^}]*\bHISTORY_NOT_SAVED\b[^}]*\bsettleHistory\b[^}]*\} from "@\/lib\/history-retry"|import \{[^}]*\bsettleHistory\b[^}]*\bHISTORY_NOT_SAVED\b[^}]*\} from "@\/lib\/history-retry"/);
  });

  it("settles the history in the background after the save, and tells the person only when it cannot", () => {
    expect(code).toMatch(SETTLE);
    expect(code.match(/settleHistory\(/g)).toHaveLength(1);
  });

  it("does not wait for it: the save's own toast and the move to the next page come first", () => {
    expect(code).not.toMatch(/await settleHistory/);
    const settle = code.search(SETTLE);
    expect(code.lastIndexOf("toast.show(", settle)).toBeGreaterThan(-1);
  });

  it("hands it the body of the answer, which carries the token", () => {
    const body = SETTLE.exec(code)![1];
    expect(["sent.body", "body"]).toContain(body);
  });
});

describe("where each screen asks", () => {
  it("TenancyForm: after the details were saved, both when adding and when editing", () => {
    const code = read("TenancyForm.tsx");
    const saved = code.indexOf("toast.show(DETAILS_SAVED_TOAST)");
    expect(saved).toBeGreaterThan(-1);
    expect(code.search(SETTLE)).toBeGreaterThan(saved);
    // inside the branch of a save that went through, before the form is closed or the failure handling starts
    expect(code.search(SETTLE)).toBeLessThan(code.indexOf("setBusy(false);\n    if (sent.kind !== \"answer\")"));
  });

  it("MoveOutForm: after the move-out was saved, for details on file and for a tenant with none", () => {
    const code = read("MoveOutForm.tsx");
    const saved = code.indexOf("toast.show(moveOutToastText(");
    expect(saved).toBeGreaterThan(-1);
    expect(code.search(SETTLE)).toBeGreaterThan(saved);
    expect(code).toMatch(/sendJson<TenancyApiBody>\("\/api\/tenancies\/move-out", request\.body\)/);
  });

  it("PaymentSheet: after a payment was saved, which carries the history of a new tenant's details", () => {
    const code = read("PaymentSheet.tsx");
    const saved = code.indexOf("if (body.ok) {");
    expect(saved).toBeGreaterThan(-1);
    expect(code.search(SETTLE)).toBeGreaterThan(saved);
    expect(code.search(SETTLE)).toBeLessThan(code.indexOf("const failure = body.error;"));
  });
});

describe("UndoSheet", () => {
  it("asks after the undo was saved, and before the Payments Log retry notice may take over", () => {
    const code = read("UndoSheet.tsx");
    const saved = code.indexOf("if (body.ok) {");
    expect(saved).toBeGreaterThan(-1);
    expect(code.search(SETTLE)).toBeGreaterThan(saved);
    expect(code.search(SETTLE)).toBeLessThan(code.indexOf("if (body.logWritten === false)"));
    expect(code.search(SETTLE)).toBeLessThan(code.indexOf('body.error?.code === "conflict"'));
  });

  it("types the two history fields of the answer", () => {
    const code = read("UndoSheet.tsx");
    expect(code).toMatch(/historyWritten\?: boolean/);
    expect(code).toMatch(/historyRetryToken\?: string/);
  });
});

describe("the answers the screens read", () => {
  it("tenancy-response.ts and payment-request.ts type the two history fields", () => {
    for (const file of ["tenancy-response.ts", "payment-request.ts"]) {
      const code = withoutComments(readFileSync(new URL(`../../src/lib/${file}`, import.meta.url), "utf8"));
      expect(code, file).toMatch(/historyWritten\?: boolean/);
      expect(code, file).toMatch(/historyRetryToken\?: string/);
    }
  });
});
