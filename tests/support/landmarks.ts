import { ancestry, describe, descendants, isAriaHidden, parseHtml, textOf, type HtmlElement } from "./html";

/**
 * The checks a screen's markup has to pass for a screen reader and a keyboard, in plain words: one main area and one top
 * heading, headings that do not skip a level, controls and images that have a name, and no id used twice. It reads what a
 * render produced (`renderToStaticMarkup`); an empty list is a pass, and each problem names the element to fix.
 *
 * `main: false` is for a piece of a page (no main area or top heading of its own): the rules that are about the whole page
 * are left out, the rest still hold.
 */
export function landmarkProblems(html: string, { main = true }: { main?: boolean } = {}): string[] {
  const root = parseHtml(html);
  const all = descendants(root);
  const problems: string[] = [];
  const named = (element: HtmlElement) => hasName(element, all);

  if (main) {
    const mains = all.filter((element) => element.tag === "main").length;
    if (mains !== 1) problems.push(`The page should have exactly one <main> area, but has ${mains}.`);
    const tops = all.filter((element) => element.tag === "h1").length;
    if (tops !== 1) problems.push(`The page should have exactly one <h1> heading, but has ${tops}.`);
  }

  // A heading may be one level deeper than the one before it, or any level shallower. The first heading of a whole page is an h1.
  let previous = 0;
  for (const heading of all.filter((element) => /^h[1-6]$/.test(element.tag))) {
    const level = Number(heading.tag[1]);
    const allowed = previous === 0 && !main ? 6 : previous + 1;
    if (level > allowed) {
      problems.push(
        previous === 0
          ? `The first heading is an <h${level}>, not an <h1>: "${textOf(heading)}".`
          : `A heading level is skipped: <h${level}> "${textOf(heading)}" comes right after an <h${previous}>.`,
      );
    }
    previous = level;
  }

  for (const element of all) {
    if (isAriaHidden(element)) continue;
    if ((element.tag === "a" || element.tag === "button") && !named(element)) {
      problems.push(`A ${element.tag === "a" ? "link" : "button"} has no text and no aria-label: ${describe(element)}`);
    }
    if (isTextControl(element) && !hasLabel(element, all)) {
      problems.push(`A field has no label (a <label for>, a wrapping <label> or an aria-label): ${describe(element)}`);
    }
    if (element.tag === "img" && element.attrs.alt === undefined) {
      problems.push(`An image has no alt text: ${describe(element)}`);
    }
    if (element.tag === "svg" && !isNamedOrHidden(element, all)) {
      problems.push(`A drawing is neither aria-hidden="true" nor role="img" with a name: ${describe(element)}`);
    }
  }

  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const element of all) {
    const id = element.attrs.id;
    if (id === undefined || id === "") continue;
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  for (const id of repeated) problems.push(`The id "${id}" is used more than once.`);

  return problems;
}

const byId = (all: HtmlElement[], id: string) => all.find((element) => element.attrs.id === id);

/** A name from a label attribute: aria-label with text, or aria-labelledby naming an element that is there. */
function ariaName(element: HtmlElement, all: HtmlElement[]): boolean {
  if ((element.attrs["aria-label"] ?? "").trim() !== "") return true;
  const ids = (element.attrs["aria-labelledby"] ?? "").split(/\s+/).filter(Boolean);
  return ids.some((id) => byId(all, id) !== undefined);
}

/** A link or button is named by its text, an image inside it that has alt text, or an aria attribute. */
function hasName(element: HtmlElement, all: HtmlElement[]): boolean {
  if (ariaName(element, all) || textOf(element) !== "") return true;
  return descendants(element).some((inner) => inner.tag === "img" && (inner.attrs.alt ?? "").trim() !== "");
}

const NOT_TEXT = new Set(["hidden", "submit", "button", "reset", "image"]);

/** A field a person fills in or ticks: not a hidden input or a button drawn as an input. */
function isTextControl(element: HtmlElement): boolean {
  if (element.tag === "select" || element.tag === "textarea") return true;
  return element.tag === "input" && !NOT_TEXT.has((element.attrs.type ?? "text").toLowerCase());
}

/** A field is named by an aria attribute, a `<label for>` with text, or a `<label>` around it that has text. */
function hasLabel(element: HtmlElement, all: HtmlElement[]): boolean {
  if (ariaName(element, all)) return true;
  const id = element.attrs.id;
  if (id !== undefined && id !== "" && all.some((label) => label.tag === "label" && label.attrs.for === id && textOf(label) !== "")) {
    return true;
  }
  return ancestry(element).some((around) => around.tag === "label" && textOf(around) !== "");
}

/** A drawing is fine when it is hidden from screen readers (itself or by a parent), or is an image with a name. */
function isNamedOrHidden(svg: HtmlElement, all: HtmlElement[]): boolean {
  if (isAriaHidden(svg)) return true;
  if (svg.attrs.role !== "img") return false;
  return ariaName(svg, all) || descendants(svg).some((inner) => inner.tag === "title" && textOf(inner) !== "");
}
