import { describe, expect, it } from "vitest";
import { ancestry, classesOf, decode, describe as describeElement, descendants, inside, isAriaHidden, link, named, pageText, parseHtml, textOf } from "./html";

const first = (html: string, tag: string) => descendants(parseHtml(html)).find((element) => element.tag === tag)!;

describe("parseHtml", () => {
  it("reads nested elements, text and attributes", () => {
    const root = parseHtml('<main class="a b"><h1>Title</h1><p>One <b>two</b></p></main>');
    expect(descendants(root).map((element) => element.tag)).toEqual(["main", "h1", "p", "b"]);
    expect(classesOf(first('<p class="a  b">x</p>', "p"))).toEqual(["a", "b"]);
    expect(textOf(first("<p>One <b>two</b></p>", "p"))).toBe("One two");
  });

  it("does not take a > inside a quoted value for the end of the tag", () => {
    const a = first('<a href="/x" aria-label="a > b">go</a>', "a");
    expect(a.attrs["aria-label"]).toBe("a > b");
    expect(textOf(a)).toBe("go");
  });

  it("knows the elements that have no closing tag, and the ones that close themselves", () => {
    const root = parseHtml('<form><input type="text" name="x"><br><svg><path d="M0 0"/></svg><button>Go</button></form>');
    const form = descendants(root).find((element) => element.tag === "form")!;
    expect(form.children.map((child) => (typeof child === "string" ? child : child.tag))).toEqual(["input", "br", "svg", "button"]);
  });

  it("gives an attribute with no value as an empty string, and decodes entities", () => {
    expect(first("<input disabled>", "input").attrs.disabled).toBe("");
    expect(first('<p title="Asha&#x27;s &amp; Bala&quot;">x</p>', "p").attrs.title).toBe(`Asha's & Bala"`);
    expect(decode("&lt;b&gt;&nbsp;&#8377;")).toBe("<b> ₹");
  });

  it("keeps the content of a script or a style as text", () => {
    const root = parseHtml("<main><script>if (a < b) { x(); }</script><p>after</p></main>");
    expect(descendants(root).map((element) => element.tag)).toEqual(["main", "script", "p"]);
    expect(textOf(descendants(root)[0])).toBe("after");
  });

  it("reads a whole render as the text a person reads", () => {
    expect(pageText("<main><h1>Asha&#x27;s flat</h1><p>Pay <b>₹&nbsp;5,450</b></p><script>x()</script></main>")).toBe("Asha's flat Pay ₹ 5,450");
  });

  it("skips comments", () => {
    expect(textOf(first("<p>a<!-- b -->c</p>", "p"))).toBe("a c");
  });
});

describe("finding elements", () => {
  const html = '<main><section><a href="/a">One</a><a href="/b" aria-label="Two">2</a></section><a href="/c">Three</a></main>';

  it("lists the elements of a tag in a render, or under one element", () => {
    expect(named(html, "a").map((anchor) => anchor.attrs.href)).toEqual(["/a", "/b", "/c"]);
    expect(inside(named(html, "section")[0], "a").map((anchor) => anchor.attrs.href)).toEqual(["/a", "/b"]);
    expect(named(html, "h1")).toEqual([]);
  });

  it("finds a link by its text or its aria-label", () => {
    expect(link(html, "One")?.attrs.href).toBe("/a");
    expect(link(html, "Two")?.attrs.href).toBe("/b");
    expect(link(html, "Four")).toBeUndefined();
  });
});

describe("what sits where", () => {
  it("lists the parents nearest first, and finds a hidden branch", () => {
    const svg = first('<main><button aria-hidden="true"><svg><path/></svg></button></main>', "svg");
    expect(ancestry(svg).map((element) => element.tag)).toEqual(["svg", "button", "main"]);
    expect(isAriaHidden(svg)).toBe(true);
    expect(isAriaHidden(first("<main><svg></svg></main>", "svg"))).toBe(false);
  });

  it("leaves what is hidden out of a text", () => {
    expect(textOf(first('<button>Add<svg aria-hidden="true"><title>Plus</title></svg></button>', "button"))).toBe("Add");
  });

  it("describes an element by its opening tag, shortened", () => {
    expect(describeElement(first('<a href="/x" class="y">z</a>', "a"))).toBe('<a href="/x" class="y">');
    expect(describeElement(first(`<a href="${"x".repeat(200)}">z</a>`, "a")).length).toBeLessThanOrEqual(120);
  });
});
