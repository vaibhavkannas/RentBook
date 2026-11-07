import { describe, expect, it } from "vitest";
import { landmarkProblems } from "./landmarks";

const page = (body: string) => `<main><h1>Title</h1>${body}</main>`;

describe("landmarkProblems", () => {
  it("passes a page with one main area, one h1 and everything named", () => {
    expect(
      landmarkProblems(
        page(
          '<h2>Section</h2><a href="/x">Home</a><button type="button" aria-label="Close"><svg aria-hidden="true"><path/></svg></button>' +
            '<label for="a">Name</label><input id="a" type="text"><img src="/x.png" alt="A flat">',
        ),
      ),
    ).toEqual([]);
  });

  describe("the main area and the h1", () => {
    it("fails a page with no main area, or two", () => {
      expect(landmarkProblems("<h1>T</h1>")).toEqual(["The page should have exactly one <main> area, but has 0."]);
      expect(landmarkProblems("<main><h1>T</h1></main><main></main>")).toEqual(["The page should have exactly one <main> area, but has 2."]);
    });

    it("fails a page with no h1, or two", () => {
      expect(landmarkProblems("<main><p>x</p></main>")).toEqual(["The page should have exactly one <h1> heading, but has 0."]);
      expect(landmarkProblems("<main><h1>A</h1><h1>B</h1></main>")).toEqual(["The page should have exactly one <h1> heading, but has 2."]);
    });

    it("does not ask a piece of a page for either (main: false)", () => {
      expect(landmarkProblems("<section><h2>Part</h2><p>x</p></section>", { main: false })).toEqual([]);
    });
  });

  describe("headings", () => {
    it("passes levels that go one deeper at a time, and back up by any amount", () => {
      expect(landmarkProblems("<main><h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h3>E</h3><h2>F</h2></main>")).toEqual([]);
      expect(landmarkProblems("<main><h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h2>E</h2></main>")).toEqual([]);
    });

    it("fails a skipped level", () => {
      expect(landmarkProblems("<main><h1>Title</h1><h3>Deep</h3></main>")).toEqual([
        'A heading level is skipped: <h3> "Deep" comes right after an <h1>.',
      ]);
    });

    it("fails a whole page that starts below an h1", () => {
      expect(landmarkProblems("<main><h2>First</h2><h1>Title</h1></main>")).toEqual(['The first heading is an <h2>, not an <h1>: "First".']);
    });

    it("lets a piece of a page start at any level, and still holds it to no skips", () => {
      expect(landmarkProblems("<div><h3>A</h3><h4>B</h4></div>", { main: false })).toEqual([]);
      expect(landmarkProblems("<div><h2>A</h2><h4>B</h4></div>", { main: false })).toEqual([
        'A heading level is skipped: <h4> "B" comes right after an <h2>.',
      ]);
    });
  });

  describe("links and buttons", () => {
    it("passes text, text in a child, an aria-label, an aria-labelledby that is there, and an image with alt text", () => {
      expect(landmarkProblems(page('<a href="/a">Go</a><a href="/b"><span>Go</span></a><a href="/c" aria-label="Go"></a>'))).toEqual([]);
      expect(landmarkProblems(page('<span id="t">Go</span><button aria-labelledby="t"></button><a href="/d"><img src="/i.png" alt="Home"></a>'))).toEqual([]);
    });

    it("fails a link with nothing to read", () => {
      expect(landmarkProblems(page('<a href="/x"><svg aria-hidden="true"><path/></svg></a>'))).toEqual([
        'A link has no text and no aria-label: <a href="/x">',
      ]);
      expect(landmarkProblems(page('<a href="/x">  </a>'))).toHaveLength(1);
    });

    it("fails a button with nothing to read, an empty label, or a labelledby that points nowhere", () => {
      expect(landmarkProblems(page('<button type="button"></button>'))).toEqual(['A button has no text and no aria-label: <button type="button">']);
      expect(landmarkProblems(page('<button aria-label=" ">'+'</button>'))).toHaveLength(1);
      expect(landmarkProblems(page('<button aria-labelledby="nobody"></button>'))).toHaveLength(1);
    });

    it("leaves out what is hidden from screen readers", () => {
      expect(landmarkProblems(page('<div aria-hidden="true"><button></button></div>'))).toEqual([]);
    });
  });

  describe("fields", () => {
    it("passes a label for the field, a label around it, an aria-label and an aria-labelledby", () => {
      expect(landmarkProblems(page('<label for="a">A</label><input id="a" type="text"><label>B <select><option>1</option></select></label>'))).toEqual([]);
      expect(landmarkProblems(page('<textarea aria-label="Notes"></textarea><span id="n">N</span><input type="number" aria-labelledby="n">'))).toEqual([]);
    });

    it("fails a field with no label, an input of no type (it is text), a select and a text area", () => {
      expect(landmarkProblems(page('<input type="text" name="a">'))).toEqual([
        'A field has no label (a <label for>, a wrapping <label> or an aria-label): <input type="text" name="a">',
      ]);
      expect(landmarkProblems(page('<input name="b">'))).toHaveLength(1);
      expect(landmarkProblems(page("<select></select><textarea></textarea>"))).toHaveLength(2);
    });

    it("fails a label that names another field, or that has no text", () => {
      expect(landmarkProblems(page('<label for="other">A</label><input id="a" type="text">'))).toHaveLength(1);
      expect(landmarkProblems(page('<label for="a"></label><input id="a" type="text">'))).toHaveLength(1);
    });

    it("does not ask a hidden input or a submit button for a label", () => {
      expect(landmarkProblems(page('<input type="hidden" name="h"><input type="submit" value="Go"><input type="button"><input type="reset">'))).toEqual([]);
    });

    it("asks a checkbox and a radio button for one", () => {
      expect(landmarkProblems(page('<input type="checkbox"><input type="radio">'))).toHaveLength(2);
      expect(landmarkProblems(page('<label><input type="checkbox"> Yes</label>'))).toEqual([]);
    });
  });

  describe("images and drawings", () => {
    it("passes an image with alt text, or an empty alt for a decoration", () => {
      expect(landmarkProblems(page('<img src="/a.png" alt="A"><img src="/b.png" alt="">'))).toEqual([]);
    });

    it("fails an image with no alt attribute", () => {
      expect(landmarkProblems(page('<img src="/a.png">'))).toEqual(['An image has no alt text: <img src="/a.png">']);
    });

    it("passes a drawing that is hidden (itself or by a parent), or is an image with a name", () => {
      expect(landmarkProblems(page('<svg aria-hidden="true"></svg><span aria-hidden="true"><svg></svg></span>'))).toEqual([]);
      expect(landmarkProblems(page('<svg role="img" aria-label="Mark"></svg><svg role="img"><title>Mark</title></svg>'))).toEqual([]);
    });

    it("fails a drawing that is neither, or an image role with no name", () => {
      expect(landmarkProblems(page("<svg><path/></svg>"))).toEqual(['A drawing is neither aria-hidden="true" nor role="img" with a name: <svg>']);
      expect(landmarkProblems(page('<svg role="img"></svg>'))).toHaveLength(1);
    });
  });

  describe("ids", () => {
    it("passes ids that are all different", () => {
      expect(landmarkProblems(page('<p id="a"></p><p id="b"></p>'))).toEqual([]);
    });

    it("fails an id used twice, once for each id", () => {
      expect(landmarkProblems(page('<p id="a"></p><p id="a"></p><p id="a"></p><p id="b"></p><p id="b"></p>'))).toEqual([
        'The id "a" is used more than once.',
        'The id "b" is used more than once.',
      ]);
    });
  });

  it("lists every problem, in plain words", () => {
    expect(landmarkProblems('<main><h2>x</h2><button></button><img src="/a.png"></main>')).toHaveLength(4);
  });
});
