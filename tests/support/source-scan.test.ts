import { describe, expect, it } from "vitest";
import { withoutComments, withoutCommentsAndStrings } from "./source-scan";

describe("withoutComments", () => {
  it("blanks line and block comments and keeps the code and the strings", () => {
    expect(withoutComments('a(); // gone\nb("kept"); /* gone */ c();')).toBe('a();  \nb("kept");   c();');
  });

  it("does not take a comment mark inside a string for a comment", () => {
    expect(withoutComments('const url = "https://example.com/"; f();')).toBe('const url = "https://example.com/"; f();');
    expect(withoutComments("const s = '/* not a comment */'; f();")).toBe("const s = '/* not a comment */'; f();");
  });

  it("keeps template text, and a string mark inside a comment does not open a string", () => {
    expect(withoutComments("const t = `a // b`;")).toBe("const t = `a // b`;");
    expect(withoutComments('// it\'s "quoted"\nf();')).toBe(" \nf();");
  });
});

describe("withoutCommentsAndStrings", () => {
  it("also empties the strings, so a name inside one is not a call", () => {
    expect(withoutCommentsAndStrings('f("requireUser()"); // requireUser()\ng(`x`);')).toBe('f("");  \ng("");');
  });
});
