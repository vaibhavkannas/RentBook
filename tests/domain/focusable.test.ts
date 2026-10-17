import { describe, expect, it } from "vitest";
import { FOCUSABLE_SELECTOR, tabbable } from "@/lib/focusable";

// Which elements a Tab press can land on. A bottom sheet keeps Tab inside itself by cycling through these, so the list
// must hold every kind of control (not only buttons) and leave out what a person cannot reach.

describe("FOCUSABLE_SELECTOR", () => {
  const parts = FOCUSABLE_SELECTOR.split(",").map((part) => part.trim());

  it("covers links, buttons, fields, selects, text areas, summaries and anything given a tab index", () => {
    for (const wanted of ["a[href]", "summary"]) expect(parts).toContain(wanted);
    for (const tag of ["button", "input", "select", "textarea"]) {
      expect(parts.some((part) => part.startsWith(tag))).toBe(true);
    }
    expect(parts.some((part) => part.startsWith("[tabindex]"))).toBe(true);
  });

  it("leaves out what is disabled, a hidden input, and what was taken out of the tab order", () => {
    for (const tag of ["button", "input", "select", "textarea"]) {
      expect(parts.find((part) => part.startsWith(tag))).toContain(":not([disabled])");
    }
    expect(parts.find((part) => part.startsWith("input"))).toContain(":not([type='hidden'])");
    expect(parts.find((part) => part.startsWith("[tabindex]"))).toContain(":not([tabindex='-1'])");
  });
});

describe("tabbable", () => {
  type Fake = { name: string; checkVisibility?: () => boolean; getClientRects?: () => { length: number } };
  const rootOf = (elements: Fake[]) => {
    const asked: string[] = [];
    const root = {
      querySelectorAll: (selector: string) => {
        asked.push(selector);
        return elements;
      },
    } as unknown as ParentNode;
    return { root, asked };
  };
  const names = (found: HTMLElement[]) => found.map((element) => (element as unknown as Fake).name);

  it("asks for the focusable elements, in document order", () => {
    const { root, asked } = rootOf([
      { name: "a", checkVisibility: () => true },
      { name: "b", checkVisibility: () => true },
    ]);
    expect(names(tabbable(root))).toEqual(["a", "b"]);
    expect(asked).toEqual([FOCUSABLE_SELECTOR]);
  });

  it("leaves out an element the browser does not show, such as a field inside a closed details element", () => {
    const { root } = rootOf([
      { name: "summary", checkVisibility: () => true },
      { name: "hidden field", checkVisibility: () => false },
      { name: "save", checkVisibility: () => true },
    ]);
    expect(names(tabbable(root))).toEqual(["summary", "save"]);
  });

  it("falls back on the element's layout boxes in a browser that cannot say whether it is visible", () => {
    const { root } = rootOf([
      { name: "shown", getClientRects: () => ({ length: 1 }) },
      { name: "not shown", getClientRects: () => ({ length: 0 }) },
    ]);
    expect(names(tabbable(root))).toEqual(["shown"]);
  });
});
