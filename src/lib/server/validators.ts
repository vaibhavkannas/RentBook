import "server-only";
import { z } from "zod";
import { dayProblem, textProblem } from "@/lib/domain/input-rules";

// The date range is plain code the browser can use too, so it lives in src/lib; the server's validators share it.
export { FIRST_YEAR, isDayInRange, LAST_YEAR } from "@/lib/domain/input-rules";

type SafeTextOptions = {
  /** Multi-line text (notes): line breaks and tabs are allowed. Everything else is one line. */
  allowNewlines?: boolean;
  /** The text may not be empty, and its limit reads "1 to N characters". */
  required?: boolean;
  /** What the field is called in the message a person reads, such as "Phone". */
  label?: string;
};

/**
 * Text from a person: trimmed, at most `max` characters, and free of control characters (line breaks and tabs
 * too, unless `allowNewlines`). The messages are in plain words and name the field by `label`.
 */
export function safeText(max: number, options: SafeTextOptions = {}) {
  const { allowNewlines, required, label = "This text" } = options;
  return z
    .string()
    .trim()
    .superRefine((text, ctx) => {
      const problem = textProblem(text, label, { max, allowNewlines, required });
      if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
    });
}

/** The longest text a date field takes, so a huge string is refused before it is looked at. */
const MAX_DAY_TEXT = 200;

/**
 * A day written YYYY-MM-DD, real, in a year from 2000 to 2100. The spaces around it are ignored when it is judged,
 * and the text is returned as it was given. `allowBlank` lets an empty field through (an optional date).
 */
export function isoDay(label: string, options: { allowBlank?: boolean } = {}) {
  return z
    .string()
    .max(MAX_DAY_TEXT, `${label} must be a real date (YYYY-MM-DD).`)
    .superRefine((text, ctx) => {
      const day = text.trim();
      if (day === "" && options.allowBlank) return;
      const problem = dayProblem(day, label);
      if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
    });
}
