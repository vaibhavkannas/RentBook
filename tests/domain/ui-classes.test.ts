import { describe, expect, it } from "vitest";
import {
  buttonClasses,
  CARD,
  cx,
  FIELD_CONTROL,
  fieldControlClasses,
  noticeClasses,
  pageClasses,
  pillClasses,
  SKELETON_BAR,
  type ButtonSize,
  type ButtonVariant,
} from "@/lib/ui-classes";

// The class strings the shared pieces are drawn with. They are the ones the screens use today, so moving a screen
// onto a primitive moves nothing; Tailwind finds them here, in full, as it does anywhere in src.

const tokens = (classes: string) => classes.split(/\s+/);

describe("buttonClasses", () => {
  const BASE = ["press", "inline-flex", "items-center", "justify-center", "gap-2", "rounded-xl", "px-4", "font-medium", "disabled:opacity-60"];

  it("gives every button the same base: press feedback, centred content, the usual shape", () => {
    for (const variant of ["primary", "secondary", "danger", "dangerText", "quiet"] as const) {
      for (const size of ["lg", "md"] as const) {
        expect(tokens(buttonClasses(variant, size))).toEqual(expect.arrayContaining(BASE));
      }
    }
  });

  it.each([
    ["primary", ["bg-accent", "text-accent-ink"]],
    ["secondary", ["border", "border-control"]],
    ["danger", ["bg-danger-bg", "text-danger-ink"]],
    ["dangerText", ["text-danger-ink", "underline"]],
    ["quiet", ["text-muted"]],
  ] as [ButtonVariant, string[]][])("the %s variant has its colours", (variant, expected) => {
    expect(tokens(buttonClasses(variant, "md"))).toEqual(expect.arrayContaining(expected));
  });

  it("keeps the variants apart", () => {
    expect(buttonClasses("primary", "md")).not.toContain("border-control");
    expect(buttonClasses("secondary", "md")).not.toContain("bg-accent");
    expect(buttonClasses("danger", "md")).not.toContain("underline");
    expect(buttonClasses("quiet", "md")).not.toContain("text-danger-ink");
  });

  it("is 48 px tall for lg and 44 px for md, so a thumb always hits it", () => {
    expect(tokens(buttonClasses("primary", "lg"))).toContain("min-h-12");
    expect(tokens(buttonClasses("primary", "lg"))).not.toContain("min-h-11");
    expect(tokens(buttonClasses("primary", "md"))).toContain("min-h-11");
    expect(tokens(buttonClasses("primary", "md"))).not.toContain("min-h-12");
  });

  it("is at least 44 px tall for every size", () => {
    for (const size of ["lg", "md"] as ButtonSize[]) {
      expect(buttonClasses("quiet", size)).toMatch(/\bmin-h-1[12]\b/);
    }
  });
});

describe("FIELD_CONTROL", () => {
  it("is the text field every form uses today", () => {
    expect(FIELD_CONTROL).toBe("mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base");
  });

  it("is a 16 px text field, so a phone does not zoom in when it takes focus", () => {
    expect(tokens(FIELD_CONTROL)).toContain("text-base");
  });
});

describe("fieldControlClasses", () => {
  it("starts from FIELD_CONTROL and dims a disabled field", () => {
    expect(fieldControlClasses()).toContain(FIELD_CONTROL);
    expect(tokens(fieldControlClasses())).toContain("disabled:opacity-50");
  });

  it("makes the large variant (the amount) text-lg instead of text-base", () => {
    const large = tokens(fieldControlClasses("input", true));
    expect(large).toContain("text-lg");
    expect(large).not.toContain("text-base");
    expect(large).toContain("min-h-12");
  });

  it("adds vertical padding to a text area and drops the minimum height", () => {
    const area = tokens(fieldControlClasses("textarea"));
    expect(area).toContain("py-2");
    expect(area).not.toContain("min-h-12");
    expect(area).toEqual(expect.arrayContaining(["mt-1", "w-full", "rounded-xl", "border", "border-control", "bg-surface", "px-3", "text-base"]));
  });
});

describe("noticeClasses", () => {
  it.each([
    ["success", "bg-success-bg text-success-ink"],
    ["warn", "bg-warn-bg text-warn-ink"],
    ["danger", "bg-danger-bg text-danger-ink"],
  ] as const)("a %s notice is a small rounded box in the %s colours", (tone, colours) => {
    expect(noticeClasses(tone)).toBe(`rounded-lg px-3 py-2 text-sm ${colours}`);
  });
});

describe("pillClasses", () => {
  const BASE = "shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium";

  it.each([
    ["success", "bg-success-bg text-success-ink"],
    ["warn", "bg-warn-bg text-warn-ink"],
    ["danger", "bg-danger-bg text-danger-ink"],
    ["neutral", "bg-line text-foreground"],
  ] as const)("a %s pill is a small label in the %s colours", (tone, colours) => {
    expect(pillClasses(tone)).toBe(`${BASE} ${colours}`);
  });
});

describe("the card, the skeleton bar and the page", () => {
  it("keep the look of today's screens", () => {
    expect(CARD).toBe("rounded-2xl border border-line bg-surface p-4");
    expect(SKELETON_BAR).toBe("rounded-lg bg-line animate-pulse motion-reduce:animate-none");
  });

  it("makes the page the single phone column with a 16 px gutter", () => {
    expect(pageClasses(false)).toBe("mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4");
  });

  it("centres the content of a sign-in or error page, and keeps the bottom padding", () => {
    expect(pageClasses(true)).toBe("mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4 flex flex-col justify-center");
  });
});

describe("cx", () => {
  it("joins the class names and skips anything empty", () => {
    expect(cx("a", false, "b", null, undefined, "", "c")).toBe("a b c");
    expect(cx()).toBe("");
  });
});
