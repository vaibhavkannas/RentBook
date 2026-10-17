import { describe, expect, it } from "vitest";
import { smallTargets, smallTextControls, unpressedTargets } from "./tap-targets";

describe("smallTargets", () => {
  it("is empty for markup with no button or link", () => {
    expect(smallTargets("<main><p>Nothing to press</p></main>")).toEqual([]);
  });

  it.each(["min-h-11", "min-h-12", "min-h-16", "h-11", "h-12", "size-11", "size-12"])(
    "accepts a button or a link with %s",
    (name) => {
      expect(smallTargets(`<button type="button" class="px-4 ${name} font-medium">x</button>`)).toEqual([]);
      expect(smallTargets(`<a href="/" class="${name}">x</a>`)).toEqual([]);
    },
  );

  it("lists a button or a link that has none of them, as its opening tag", () => {
    const html = '<button type="button" class="px-4 py-1">a</button><a href="/x" class="text-sm underline">b</a>';
    expect(smallTargets(html)).toEqual(['<button type="button" class="px-4 py-1">', '<a href="/x" class="text-sm underline">']);
  });

  it("lists a button or a link with no class at all", () => {
    expect(smallTargets('<button type="button">a</button>')).toEqual(['<button type="button">']);
  });

  it("reads a class as a whole name: min-h-110 and md:min-h-11 are not min-h-11", () => {
    expect(smallTargets('<button class="min-h-110">a</button>')).toHaveLength(1);
    expect(smallTargets('<button class="md:min-h-11">a</button>')).toHaveLength(1);
    expect(smallTargets('<button class="h-110">a</button>')).toHaveLength(1);
  });

  it("does not take other elements for a link or a button", () => {
    expect(smallTargets('<article class="x"><abbr>a</abbr><b>b</b><nav aria-label="Main"></nav></article>')).toEqual([]);
  });

  it("finds a tag whose attribute value holds a > or a newline", () => {
    expect(smallTargets('<button aria-label="a > b" class="x">a</button>')).toEqual(['<button aria-label="a > b" class="x">']);
    expect(smallTargets('<a href="/"\n  class="min-h-11">a</a>')).toEqual([]);
  });
});

describe("unpressedTargets", () => {
  it("lists a button or a link that lacks press, and accepts one that has it", () => {
    expect(unpressedTargets('<button class="press min-h-11">a</button><a href="/" class="min-h-11 press">b</a>')).toEqual([]);
    expect(unpressedTargets('<button class="min-h-11">a</button>')).toEqual(['<button class="min-h-11">']);
    expect(unpressedTargets('<a href="/" class="pressed">b</a>')).toEqual(['<a href="/" class="pressed">']);
  });
});

describe("smallTextControls", () => {
  it("accepts a text field, a select and a text area with text-base or text-lg", () => {
    expect(smallTextControls('<input class="mt-1 text-base"/><select class="text-lg"></select><textarea class="text-base"></textarea>')).toEqual([]);
  });

  it("lists a field whose text is smaller, or that has no size", () => {
    const html = '<input class="text-sm"/><select class="px-3"></select><textarea></textarea>';
    expect(smallTextControls(html)).toEqual(['<input class="text-sm"/>', '<select class="px-3">', "<textarea>"]);
  });

  it("does not count a tick box, a radio button or a button-like input, which are not typed into", () => {
    for (const type of ["checkbox", "radio", "hidden", "submit", "button", "range", "file"]) {
      expect(smallTextControls(`<input type="${type}" class="size-5"/>`), type).toEqual([]);
    }
  });

  it("does count a date, a phone and a text input", () => {
    for (const type of ["date", "tel", "text", "email", "number"]) {
      expect(smallTextControls(`<input type="${type}" class="size-5"/>`), type).toHaveLength(1);
    }
  });
});
