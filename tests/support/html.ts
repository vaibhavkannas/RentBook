/**
 * A small reader for the markup a screen renders (`renderToStaticMarkup`), for the checks that need to know what sits inside
 * what: the landmark rules and the long-name wrapping rule. The markup is well formed, so it is a tree of elements and text;
 * nothing here repairs bad HTML. Attribute values and text are returned with the common entities decoded.
 */

export type HtmlElement = {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlChild[];
  parent: HtmlElement | null;
};
export type HtmlChild = HtmlElement | string;

/** Elements that have no closing tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/** Elements whose content is not markup. */
const RAW = new Set(["script", "style"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decode(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex, dec, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number(dec));
    return ENTITIES[String(name).toLowerCase()] ?? whole;
  });
}

const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|[^<]+|</g;
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attributesOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) attrs[match[1]] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  return attrs;
}

/** The root element (tag `#root`) of a tree holding everything in `html`. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attrs: {}, children: [], parent: null };
  let open = root;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(html); match !== null; match = TOKEN.exec(html)) {
    const [token, closing, name, source, selfClosing] = match;
    if (token.startsWith("<!--")) continue;
    if (name === undefined) {
      open.children.push(decode(token));
      continue;
    }
    const tag = name.toLowerCase();
    if (closing) {
      // Close the nearest open element of that name; a stray closing tag closes nothing.
      for (let at: HtmlElement | null = open; at !== null; at = at.parent) {
        if (at.tag === tag) {
          open = at.parent ?? root;
          break;
        }
      }
      continue;
    }
    const element: HtmlElement = { tag, attrs: attributesOf(source), children: [], parent: open };
    open.children.push(element);
    if (RAW.has(tag) && !selfClosing) {
      const end = html.toLowerCase().indexOf(`</${tag}`, TOKEN.lastIndex);
      const stop = end === -1 ? html.length : end;
      element.children.push(html.slice(TOKEN.lastIndex, stop));
      TOKEN.lastIndex = stop;
      continue;
    }
    if (!VOID.has(tag) && !selfClosing) open = element;
  }
  return root;
}

/** Every element under `node` (not `node` itself), in document order. */
export function descendants(node: HtmlElement): HtmlElement[] {
  return node.children.flatMap((child) => (typeof child === "string" ? [] : [child, ...descendants(child)]));
}

/** `node` and its parents, nearest first (the `#root` is left out). */
export function ancestry(node: HtmlElement): HtmlElement[] {
  const chain: HtmlElement[] = [];
  for (let at: HtmlElement | null = node; at !== null && at.tag !== "#root"; at = at.parent) chain.push(at);
  return chain;
}

export const classesOf = (node: HtmlElement): string[] => (node.attrs.class ?? "").split(/\s+/).filter(Boolean);

/** True when the element, or one of its parents, is hidden from assistive technology with aria-hidden="true". */
export const isAriaHidden = (node: HtmlElement): boolean => ancestry(node).some((at) => at.attrs["aria-hidden"] === "true");

/** The text a person reads inside an element: what is not under aria-hidden, a script or a style, with spaces collapsed. */
export function textOf(node: HtmlElement): string {
  const parts = (at: HtmlElement): string[] =>
    at.attrs["aria-hidden"] === "true" || RAW.has(at.tag)
      ? []
      : at.children.flatMap((child) => (typeof child === "string" ? [child] : parts(child)));
  return parts(node).join(" ").replace(/[\s ]+/g, " ").trim();
}

/** The opening tag of an element as it was written, shortened, for a message. */
export function describe(node: HtmlElement): string {
  const attrs = Object.entries(node.attrs).map(([name, value]) => (value === "" ? name : `${name}="${value}"`));
  const tag = `<${[node.tag, ...attrs].join(" ")}>`;
  return tag.length > 120 ? `${tag.slice(0, 117)}...` : tag;
}
