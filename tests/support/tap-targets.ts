/**
 * Checks on the markup a screen renders, for touch: does every button and link have room for a thumb, does every
 * control keep text large enough that a phone does not zoom in on it, and does every button and link answer a press.
 * Each function takes the HTML of a render and returns the offending opening tags, so an empty list is a pass and a
 * failure message shows exactly what to fix.
 */

/** An opening tag of one of `names`; attribute values may hold a `>`, so quoted values are skipped whole. */
const openingTags = (html: string, names: string) =>
  [...html.matchAll(new RegExp(`<(?:${names})\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, "g"))].map((match) => match[0]);

const classTokens = (tag: string) => (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The classes that give a button or a link at least 44 px of height (the least a thumb should be asked to hit). */
export const TAP_TARGET_CLASSES = ["min-h-11", "min-h-12", "min-h-16", "h-11", "h-12", "size-11", "size-12"];

/** Every `<button>` and `<a>` whose classes give it no height of 44 px or more. */
export function smallTargets(html: string): string[] {
  return openingTags(html, "button|a").filter((tag) => !classTokens(tag).some((name) => TAP_TARGET_CLASSES.includes(name)));
}

/** Every `<button>` and `<a>` that does not carry `press`, the feedback a control gives while it is held down. */
export function unpressedTargets(html: string): string[] {
  return openingTags(html, "button|a").filter((tag) => !classTokens(tag).includes("press"));
}

/** The inputs that open no keyboard and are not text: they are drawn at their own size. */
const NOT_TEXT = new Set(["checkbox", "radio", "hidden", "submit", "button", "reset", "range", "file", "color", "image"]);

/** Every text field, select and text area whose classes lack `text-base` or `text-lg`: a phone zooms in on a smaller one. */
export function smallTextControls(html: string): string[] {
  return openingTags(html, "input|select|textarea").filter((tag) => {
    if (tag.startsWith("<input") && NOT_TEXT.has(attribute(tag, "type") ?? "text")) return false;
    const tokens = classTokens(tag);
    return !tokens.includes("text-base") && !tokens.includes("text-lg");
  });
}
