import { validation } from "@/lib/errors";
import { isValidIsoDay } from "./year-month";

/**
 * Rules for the text and dates a person types, kept free of server code so the browser can use them too.
 * The server checks everything again: validators.ts (src/lib/server) wraps these as zod schemas.
 */

/** The longest a tenant's or a portion's name may be. */
export const MAX_NAME_LENGTH = 60;

/** The earliest and latest year a date the app takes may be in. Anything else is a typing slip. */
export const FIRST_YEAR = 2000;
export const LAST_YEAR = 2100;

/**
 * Control characters: the C0 range, delete, the C1 range, and the line and paragraph separators. Letters, digits,
 * marks and joiners of every script (the invisible joiners Indian scripts need among them) are not control characters.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** The same, without tab, line feed and carriage return: what multi-line text may not have. */
const CONTROL_CHARACTERS_BESIDES_LINE_BREAKS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/;

export type TextRules = {
  /** The most characters the trimmed text may have. */
  max: number;
  /** Multi-line text (notes): line breaks and tabs are allowed. */
  allowNewlines?: boolean;
  /** The trimmed text may not be empty. */
  required?: boolean;
};

/**
 * What is wrong with `text`, which must already be trimmed, in plain words for a field called `label`; null when
 * nothing is. Too long comes first, then control characters.
 */
export function textProblem(text: string, label: string, rules: TextRules): string | null {
  if (text.length === 0 && rules.required) return `${label} must be 1 to ${rules.max} characters.`;
  if (text.length > rules.max) {
    return rules.required
      ? `${label} must be 1 to ${rules.max} characters.`
      : `${label} can have at most ${rules.max} characters.`;
  }
  if (rules.allowNewlines) {
    if (CONTROL_CHARACTERS_BESIDES_LINE_BREAKS.test(text)) {
      return `${label} cannot have control characters other than line breaks.`;
    }
  } else if (CONTROL_CHARACTERS.test(text)) {
    return `${label} cannot have line breaks or other control characters.`;
  }
  return null;
}

/** The text trimmed (a missing value is empty), or a validation error from textProblem. */
export function cleanText(text: string | undefined, label: string, rules: TextRules): string {
  const trimmed = (text ?? "").trim();
  const problem = textProblem(trimmed, label, rules);
  if (problem !== null) throw validation(problem);
  return trimmed;
}

/** Whether `day` is a real YYYY-MM-DD date in a year from FIRST_YEAR to LAST_YEAR. */
export function isDayInRange(day: string): boolean {
  if (!isValidIsoDay(day)) return false;
  const year = Number(day.slice(0, 4));
  return year >= FIRST_YEAR && year <= LAST_YEAR;
}

/** What is wrong with `day` (already trimmed) for a field called `label`, in plain words; null when it is a day in range. */
export function dayProblem(day: string, label: string): string | null {
  if (day === "") return `${label} is required.`;
  if (!isValidIsoDay(day)) return `${label} must be a real date (YYYY-MM-DD).`;
  if (!isDayInRange(day)) return `${label} must be a date from ${FIRST_YEAR} to ${LAST_YEAR}.`;
  return null;
}

/** Throws a validation error unless `day` (already trimmed) is a real day in range. */
export function requireDay(day: string, label: string): void {
  const problem = dayProblem(day, label);
  if (problem !== null) throw validation(problem);
}
