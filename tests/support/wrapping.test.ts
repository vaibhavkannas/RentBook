import { describe, expect, it } from "vitest";
import { wrapProblems } from "./wrapping";

const NAME = "Anantharamakrishnanvenkateswaranmuthukrishnansubramaniamiyer";
const page = (body: string) => `<main class="p">${body}</main>`;

describe("wrapProblems", () => {
  it("passes a name that wraps: break-words on it, and min-w-0 on the part of a flex row it sits in", () => {
    expect(wrapProblems(page(`<p class="break-words">${NAME}</p>`), [NAME])).toEqual([]);
    expect(wrapProblems(page(`<div class="flex justify-between"><span class="min-w-0 break-words">${NAME}</span><span>₹ 5</span></div>`), [NAME])).toEqual([]);
  });

  it("takes break-words from an element above the name, as the property is inherited", () => {
    expect(wrapProblems(page(`<section class="break-words"><p><b>${NAME}</b></p></section>`), [NAME])).toEqual([]);
  });

  it("fails a name with no break-words above it", () => {
    const problems = wrapProblems(page(`<p class="text-sm">${NAME}</p>`), [NAME]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("has no break-words above it");
    expect(problems[0]).toContain(NAME);
  });

  it("fails a name that is cut off or kept on one line", () => {
    expect(wrapProblems(page(`<p class="truncate break-words">${NAME}</p>`), [NAME])[0]).toContain("is cut off by");
    expect(wrapProblems(page(`<p class="line-clamp-2 break-words">${NAME}</p>`), [NAME])[0]).toContain("is cut off by");
    expect(wrapProblems(page(`<div class="whitespace-nowrap"><p class="break-words">${NAME}</p></div>`), [NAME])[0]).toContain("is kept on one line by");
  });

  it("fails a name in a flex row item that may not shrink, whether the item is the name or a parent of it", () => {
    const direct = wrapProblems(page(`<div class="flex"><span class="break-words">${NAME}</span><span>x</span></div>`), [NAME]);
    expect(direct).toHaveLength(1);
    expect(direct[0]).toContain("needs min-w-0");
    const above = wrapProblems(page(`<div class="flex"><div><p class="break-words">${NAME}</p></div></div>`), [NAME]);
    expect(above).toHaveLength(1);
    expect(above[0]).toContain("needs min-w-0");
  });

  it("does not ask for min-w-0 in a column, or in an element that is not flex", () => {
    expect(wrapProblems(page(`<div class="flex flex-col"><p class="break-words">${NAME}</p></div>`), [NAME])).toEqual([]);
    expect(wrapProblems(page(`<div class="grid"><p class="break-words">${NAME}</p></div>`), [NAME])).toEqual([]);
  });

  it("takes overflow-hidden as letting a flex item shrink", () => {
    expect(wrapProblems(page(`<div class="flex"><p class="overflow-hidden break-words">${NAME}</p></div>`), [NAME])).toEqual([]);
  });

  it("looks only up to the page's main area, not at what is above it", () => {
    expect(wrapProblems(`<div class="flex whitespace-nowrap truncate"><main><p class="break-words">${NAME}</p></main></div>`, [NAME])).toEqual([]);
  });

  it("checks every place the name is shown, and every name", () => {
    const html = page(`<h2 class="break-words">${NAME}</h2><p>${NAME}</p><p class="break-words">Bala</p>`);
    expect(wrapProblems(html, [NAME])).toHaveLength(1);
    expect(wrapProblems(html, [NAME, "Bala"])).toHaveLength(1);
  });

  it("fails a name that is nowhere in the markup, because it must be shown in full", () => {
    expect(wrapProblems(page(`<p class="break-words">${NAME.slice(0, 30)}</p>`), [NAME])).toEqual([`"${NAME}" is not shown in full anywhere.`]);
  });
});
