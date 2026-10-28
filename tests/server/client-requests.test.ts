import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutComments, withoutCommentsAndStrings } from "../support/source-scan";

/**
 * Every request a component makes to the server goes through sendJson or postJson (src/lib/post-json.ts), which give up
 * after 30 seconds and say why no answer came, so a form never stays locked on a stalled connection. This reads the
 * components' source: it cannot click a button, but it finds one that calls fetch itself. (The five components send with
 * sendJson, which says offline, timeout or no answer; postJson is the same without the reason.)
 */

const COMPONENTS = fileURLToPath(new URL("../../src/components", import.meta.url));
const files = readdirSync(COMPONENTS).filter((name) => name.endsWith(".tsx")).sort();
const read = (name: string) => readFileSync(path.join(COMPONENTS, name), "utf8");

/** The components that talk to the server: their source names an address under /api/. */
const TALKING = files.filter((name) => withoutComments(read(name)).includes('"/api/'));

describe("the components that send requests to the server", () => {
  it("are found by reading the folder", () => {
    expect(TALKING).toEqual([
      "AddPortionSheet.tsx",
      "MoveOutForm.tsx",
      "PaymentSheet.tsx",
      "PortionOrder.tsx",
      "PrepareSheet.tsx",
      "SettingsForm.tsx",
      "SwitchOffSheet.tsx",
      "SwitchedOffPortions.tsx",
      "TenancyForm.tsx",
      "UndoSheet.tsx",
    ]);
  });

  it.each(TALKING)("%s imports sendJson or postJson and calls it", (name) => {
    const source = read(name);
    expect(withoutComments(source)).toMatch(/import \{[^}]*\b(?:sendJson|postJson)\b[^}]*\} from "@\/lib\/post-json"/);
    expect(withoutCommentsAndStrings(source)).toMatch(/(?<![.\w$])(?:sendJson|postJson)\s*(?:<[^>]*>)?\s*\(/);
  });

  it.each(TALKING)("%s never calls fetch itself", (name) => {
    expect(withoutCommentsAndStrings(read(name))).not.toMatch(/(?<![.\w$])fetch\s*\(/);
  });

  it("UndoSheet sends both the undo and the log retry through it", () => {
    const code = withoutComments(read("UndoSheet.tsx"));
    expect(code).toMatch(/(?:sendJson|postJson)<[^>]*>\(\s*"\/api\/payments\/undo"/);
    expect(code).toMatch(/(?:sendJson|postJson)<[^>]*>\(\s*"\/api\/payments\/log-retry"/);
  });

  it("SettingsForm saves with a PUT through it, as the settings route expects", () => {
    const code = withoutComments(read("SettingsForm.tsx"));
    expect(code).toMatch(/(?:sendJson|postJson)<[^>]*>\(\s*"\/api\/settings"[^;]*\bmethod: "PUT"/);
  });

  it("the portion screens send their changes as the routes expect: a POST to add, a PUT to switch off or on and to reorder", () => {
    expect(withoutComments(read("AddPortionSheet.tsx"))).toMatch(/(?:sendJson|postJson)<[^>]*>\(\s*"\/api\/portions"\s*,\s*request\.body\s*\)/);
    for (const name of ["SwitchOffSheet.tsx", "SwitchedOffPortions.tsx"]) {
      expect(withoutComments(read(name)), name).toMatch(/(?:sendJson|postJson)<[^>]*>\(\s*"\/api\/portions\/active"[^;]*\bmethod: "PUT"/);
    }
    expect(withoutComments(read("PortionOrder.tsx"))).toMatch(/(?:sendJson|postJson)<[^>]*>\(\s*"\/api\/portions\/order"[^;]*\bmethod: "PUT"/);
  });

  it("PaymentSheet hands the amount as typed to the builder (which reads it with amountFromText), and shows the refusal of an amount that is not a number before it sends", () => {
    const code = withoutComments(read("PaymentSheet.tsx"));
    expect(code).toMatch(/amountText:\s*amount\b/);
    expect(code).not.toMatch(/Number\(amount\b/);
    const build = code.indexOf("buildPaymentRequest(");
    const refuse = code.indexOf("if (!request.ok) return show(fieldProblem(request.message, request.field, known));");
    const send = code.indexOf('sendJson<ApiBody>("/api/payments", request.body)');
    expect(build).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(build);
    expect(send).toBeGreaterThan(refuse);
  });

  it("every one of them stops on an offline, timed-out or unanswered request and says why, instead of reading a missing answer", () => {
    for (const name of TALKING) {
      expect(withoutComments(read(name)), name).toMatch(/\bsent\.kind\b/);
    }
  });
});
