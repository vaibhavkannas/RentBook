import { ancestry, classesOf, describe, descendants, parseHtml, type HtmlElement } from "./html";

/**
 * Whether a long name in a render will wrap on a phone instead of running off the screen or being cut short. The tests run no
 * layout, so this reads the classes the name sits under, which is what decides it:
 *
 * - a name an unbroken stretch of letters long needs `break-words` somewhere above it (the property is inherited);
 * - the name must not be cut off (`truncate`, a line clamp) or kept on one line (`whitespace-nowrap`);
 * - a part of a row of `flex` items is as wide as its longest unbroken word unless it may shrink, so each such part on the
 *   way up needs `min-w-0` (or `overflow-hidden`, which lets it shrink too).
 *
 * A name inside a box that scrolls sideways (a row of chips) is scrolled by design, not wrapped, and a name only a screen reader
 * reads (`sr-only`) takes no room; both are left alone.
 *
 * `texts` are the names to look for; every place one is shown is checked. A name that is nowhere in the markup is a problem
 * too (the screen must show it in full). An empty list is a pass.
 */
export function wrapProblems(html: string, texts: string[]): string[] {
  const all = descendants(parseHtml(html));
  const problems: string[] = [];
  for (const text of texts) {
    const holders = all.filter((element) => element.children.some((child) => typeof child === "string" && child.includes(text)));
    if (holders.length === 0) problems.push(`"${text}" is not shown in full anywhere.`);
    for (const holder of holders) problems.push(...problemsAt(holder, text));
  }
  return problems;
}

const CUT_OFF = /^(?:truncate|text-ellipsis|text-clip|line-clamp-\d+)$/;

/** What stops the name `text`, shown inside `holder`, from wrapping. */
function problemsAt(holder: HtmlElement, text: string): string[] {
  // From the name up to the page's own main area: what is above it is the layout's.
  const chain = ancestry(holder);
  const mainAt = chain.findIndex((element) => element.tag === "main");
  const inside = mainAt === -1 ? chain : chain.slice(0, mainAt);
  if (inside.some((element) => classesOf(element).some((name) => name === "sr-only" || /^overflow-(?:x-)?(?:auto|scroll)$/.test(name)))) return [];
  const problems: string[] = [];
  const where = `"${text}" in ${describe(holder)}`;

  if (!inside.some((element) => classesOf(element).includes("break-words"))) {
    problems.push(`${where} has no break-words above it, so a long name runs off the screen.`);
  }
  const cut = inside.find((element) => classesOf(element).some((name) => CUT_OFF.test(name)));
  if (cut) problems.push(`${where} is cut off by ${describe(cut)}.`);
  const nowrap = inside.find((element) => classesOf(element).includes("whitespace-nowrap"));
  if (nowrap) problems.push(`${where} is kept on one line by ${describe(nowrap)}.`);

  for (const element of inside) {
    const parent = element.parent;
    if (parent && isFlexRow(parent) && !classesOf(element).some((name) => name === "min-w-0" || name === "overflow-hidden")) {
      problems.push(`${where} sits in ${describe(element)}, a part of a flex row that may not shrink (needs min-w-0).`);
    }
  }
  return problems;
}

/** A parent that lays its children out in a row with flex (not a column). */
function isFlexRow(element: HtmlElement): boolean {
  const names = classesOf(element);
  return (names.includes("flex") || names.includes("inline-flex")) && !names.includes("flex-col");
}
