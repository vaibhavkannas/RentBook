/**
 * How a header in the owner's Sheet is recognised. A header is typed by hand (or pasted from somewhere else), so
 * the same words can differ by a double space, a no-break space or an invisible character without anyone seeing it.
 */

/** Zero-width space, non-joiner, joiner and the byte order mark: invisible, and never part of a header's words. */
const INVISIBLE = /[​-‍﻿]/g;

/**
 * A header cell's text in the form headers are compared in: NFKC-normalised (full-width and ligature characters
 * become plain ones), without invisible characters, each run of whitespace (no-break spaces included) one space,
 * trimmed and lower-cased. A cell with nothing in it is "".
 */
export function headerKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The rule every header was matched by before `headerKey`: trimmed and lower-cased, nothing else. */
const plainKey = (value: unknown) => String(value ?? "").trim().toLowerCase();

export type HeaderMatch = { index: number } | { problem: "missing" | "duplicate" };

/**
 * The 0-based column of the header named `name` in a header row, or what is wrong: no such header, or more than
 * one. It tries the old rule (trimmed, any case) first and only when that finds nothing, `headerKey`. So a header
 * that matched before still matches the same column, and a second header that only the looser rule sees as the
 * same ("Count 2" and "Count  2" in one row) never turns a match into a duplicate.
 */
export function findHeader(headers: readonly unknown[], name: string): HeaderMatch {
  for (const keyOf of [plainKey, headerKey]) {
    const wanted = keyOf(name);
    const matches = headers.flatMap((header, index) => (keyOf(header) === wanted ? [index] : []));
    if (matches.length === 1) return { index: matches[0] };
    if (matches.length > 1) return { problem: "duplicate" };
  }
  return { problem: "missing" };
}
