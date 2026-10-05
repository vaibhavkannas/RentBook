import { sheetStructure } from "@/lib/errors";
import type { YearMonth } from "./types";
import {
  monthIndexFromName,
  monthName,
  serialFromYm,
  ymFromSerial,
} from "./year-month";

export type TextStyle = {
  longName: boolean;
  separator: " " | "-";
  fourDigitYear: boolean;
};

/**
 * How the Month column stores its value. `serial` is a real date cell;
 * `text` is a string such as "Oct-26" or "October 2026".
 */
export type MonthCodec =
  | { kind: "serial" }
  | { kind: "text"; style: TextStyle };

const TEXT_PATTERN = /^([A-Za-z]{3,9})([ -])(\d{2}|\d{4})$/;

function parseText(text: string): { ym: YearMonth; style: TextStyle } | null {
  const match = TEXT_PATTERN.exec(text.trim());
  if (!match) return null;
  const month = monthIndexFromName(match[1]);
  if (month === null) return null;
  const fourDigitYear = match[3].length === 4;
  const year = fourDigitYear ? Number(match[3]) : 2000 + Number(match[3]);
  return {
    ym: { year, month },
    style: {
      longName: match[1].length > 3,
      separator: match[2] as " " | "-",
      fourDigitYear,
    },
  };
}

/**
 * Work out the Month column's format from one existing cell. Refuses to
 * guess: an unrecognised value stops the app instead of writing a bad month.
 */
export function detectMonthCodec(sample: unknown): MonthCodec {
  if (typeof sample === "number") return { kind: "serial" };
  if (typeof sample === "string") {
    const parsed = parseText(sample);
    if (parsed) return { kind: "text", style: parsed.style };
  }
  throw sheetStructure(
    `Could not read the Month column format from "${String(sample)}". Expected a date or text like "Oct-26".`,
  );
}

export function readMonth(codec: MonthCodec, cell: unknown): YearMonth | null {
  if (codec.kind === "serial") {
    return typeof cell === "number" ? ymFromSerial(cell) : null;
  }
  return typeof cell === "string" ? (parseText(cell)?.ym ?? null) : null;
}

export function writeMonth(codec: MonthCodec, ym: YearMonth): string | number {
  if (codec.kind === "serial") return serialFromYm(ym);
  const { longName, separator, fourDigitYear } = codec.style;
  const year = fourDigitYear ? String(ym.year) : String(ym.year % 100).padStart(2, "0");
  return `${monthName(ym.month, longName)}${separator}${year}`;
}
