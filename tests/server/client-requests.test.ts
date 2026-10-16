import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every request a component makes to the server goes through postJson (src/lib/post-json.ts), which gives up after
 * 30 seconds and tells the person it could not confirm the save, so a form never stays locked on a stalled
 * connection. This reads the components' source: it cannot click a button, but it finds one that calls fetch itself.
 */

const COMPONENTS = fileURLToPath(new URL("../../src/components", import.meta.url));
const files = readdirSync(COMPONENTS).filter((name) => name.endsWith(".tsx")).sort();
const read = (name: string) => readFileSync(path.join(COMPONENTS, name), "utf8");

/** A comment or a string, found in the order they appear, so a comment mark inside a string is not a comment. */
const COMMENT_OR_STRING =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
const isComment = (token: string) => token.startsWith("//") || token.startsWith("/*");
const withoutComments = (source: string) => source.replace(COMMENT_OR_STRING, (t) => (isComment(t) ? " " : t));
const withoutCommentsAndStrings = (source: string) =>
  source.replace(COMMENT_OR_STRING, (t) => (isComment(t) ? " " : '""'));

/** The components that talk to the server: their source names an address under /api/. */
const TALKING = files.filter((name) => withoutComments(read(name)).includes('"/api/'));

describe("the components that send requests to the server", () => {
  it("are found by reading the folder", () => {
    expect(TALKING).toEqual([
      "MoveOutForm.tsx",
      "PaymentSheet.tsx",
      "SettingsForm.tsx",
      "TenancyForm.tsx",
      "UndoSheet.tsx",
    ]);
  });

  it.each(TALKING)("%s imports postJson and calls it", (name) => {
    const source = read(name);
    expect(withoutComments(source)).toMatch(/import \{[^}]*\bpostJson\b[^}]*\} from "@\/lib\/post-json"/);
    expect(withoutCommentsAndStrings(source)).toMatch(/(?<![.\w$])postJson\s*(?:<[^>]*>)?\s*\(/);
  });

  it.each(TALKING)("%s never calls fetch itself", (name) => {
    expect(withoutCommentsAndStrings(read(name))).not.toMatch(/(?<![.\w$])fetch\s*\(/);
  });

  it("UndoSheet sends both the undo and the log retry through it", () => {
    const code = withoutComments(read("UndoSheet.tsx"));
    expect(code).toMatch(/postJson<[^>]*>\(\s*"\/api\/payments\/undo"/);
    expect(code).toMatch(/postJson<[^>]*>\(\s*"\/api\/payments\/log-retry"/);
  });

  it("SettingsForm saves with a PUT through it, as the settings route expects", () => {
    const code = withoutComments(read("SettingsForm.tsx"));
    expect(code).toMatch(/postJson<[^>]*>\(\s*"\/api\/settings"[^;]*POST_TIMEOUT_MS,\s*"PUT"\s*,?\s*\)/);
  });

  it("PaymentSheet reads the amount with amountFromText, and shows the refusal of an amount that is not a number before it sends", () => {
    const code = withoutComments(read("PaymentSheet.tsx"));
    expect(code).toMatch(/amount:\s*amountFromText\(amount\)/);
    expect(code).not.toMatch(/Number\(amount\b/);
    const build = code.indexOf("buildPaymentRequest(");
    const refuse = code.indexOf("if (!request.ok) return setError(request.message);");
    const send = code.indexOf('postJson<ApiBody>("/api/payments", request.body)');
    expect(build).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(build);
    expect(send).toBeGreaterThan(refuse);
  });
});
