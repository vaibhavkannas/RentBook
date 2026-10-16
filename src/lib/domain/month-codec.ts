import { sheetStructure } from "@/lib/errors";
import type { YearMonth } from "./types";
import {
  isFullMonthName,
  monthIndexFromName,
  monthName,
  serialFromYm,
  ymFromSerial,
  ymKey,
} from "./year-month";

export type TextStyle = {
  longName: boolean;
  /** The characters between the month name and the year, as the sheet has them: "-", " ", "/", " '". */
  separator: string;
  fourDigitYear: boolean;
  /** The name is followed by a dot, as in "Sept.". Left out when there is none. */
  dot?: true;
};

/**
 * How a Month cell is written. Reading never uses it (every cell is read on its own, see `readMonth`);
 * it only says which style to use for a NEW month row, taken from the sheet's bottom-most month cell.
 * `serial` is a real date cell; `text` is a string such as "Oct-26" or "October 2026"; `iso` is "2026-10".
 */
export type MonthCodec =
  | { kind: "serial" }
  | { kind: "iso" }
  | { kind: "text"; style: TextStyle };

/** A Month cell outside these years is not a month of a rent schedule: the number 5, for one, is 1900-01-04. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** A month name of at least three letters, an optional dot, a separator, then a 2- or 4-digit year. */
const TEXT_PATTERN = /^([A-Za-z]{3,9})(\.?)([\s\-/']+)(\d{2}|\d{4})$/;
const ISO_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const plausible = ({ year }: YearMonth) => year >= MIN_YEAR && year <= MAX_YEAR;

/** The month a cell holds and the style it is written in, or null when the cell is not a month. */
function parseCell(cell: unknown): { ym: YearMonth; codec: MonthCodec } | null {
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return null;
    const ym = ymFromSerial(cell);
    return plausible(ym) ? { ym, codec: { kind: "serial" } } : null;
  }
  if (typeof cell !== "string") return null;
  const text = cell.trim();

  const iso = ISO_PATTERN.exec(text);
  if (iso) {
    const ym = { year: Number(iso[1]), month: Number(iso[2]) };
    return plausible(ym) ? { ym, codec: { kind: "iso" } } : null;
  }

  const match = TEXT_PATTERN.exec(text);
  if (!match) return null;
  const name = match[1];
  const month = monthIndexFromName(name);
  if (month === null) return null;
  const fourDigitYear = match[4].length === 4;
  const ym = { year: fourDigitYear ? Number(match[4]) : 2000 + Number(match[4]), month };
  if (!plausible(ym)) return null;
  const style: TextStyle = {
    // "Sept" is a short form of September, so a new row is written "Oct", not "October".
    longName: name.length > 3 && isFullMonthName(name),
    separator: match[3],
    fourDigitYear,
  };
  if (match[2] === ".") style.dot = true;
  return { ym, codec: { kind: "text", style } };
}

/**
 * Work out the style for a new month row from one existing cell. Refuses to
 * guess: an unrecognised value stops the app instead of writing a bad month.
 */
export function detectMonthCodec(sample: unknown): MonthCodec {
  const parsed = parseCell(sample);
  if (parsed) return parsed.codec;
  throw sheetStructure(
    `Could not read the Month column format from "${String(sample)}". Expected a date or text like "Oct-26".`,
  );
}

/**
 * The month one Month cell holds, or null when it is not a readable month. Each cell stands on its own:
 * a date serial (years 2000 to 2100 only), English month text such as "Sep-26", "Sept 2026" or
 * "October 2026", or ISO "2026-10".
 */
export function readMonth(cell: unknown): YearMonth | null {
  return parseCell(cell)?.ym ?? null;
}

export function writeMonth(codec: MonthCodec, ym: YearMonth): string | number {
  if (codec.kind === "serial") return serialFromYm(ym);
  if (codec.kind === "iso") return ymKey(ym);
  const { longName, separator, fourDigitYear, dot } = codec.style;
  const year = fourDigitYear ? String(ym.year) : String(ym.year % 100).padStart(2, "0");
  return `${monthName(ym.month, longName)}${dot ? "." : ""}${separator}${year}`;
}
