import { BRAND } from "@/lib/brand";

/**
 * What the owner's Sheet needs, in plain words: the rules that remain after wave 3 loosened the layout (see the audit in
 * the plan). The Set up page lists them under "What your Sheet needs", and SETUP.md says the same. Pure, so both can use it.
 * Each is a heading and a sentence or two, and tests/domain/layout-rules.test.ts ties the numbers to the code that holds them.
 */
export const LAYOUT_RULES: readonly { topic: string; text: string }[] = [
  {
    topic: "Schedule tab",
    text: "Your month rows are on one tab, called Schedule or the name you set in SCHEDULE_TAB. A tab that differs only by capitals or spaces is found too.",
  },
  {
    topic: "Header row",
    text: "One of the first 25 rows of that tab is the header row. It has Month in it and, for each portion, a Tenant, a Count and an Amount header. Capitals, extra spaces and no-break spaces do not matter.",
  },
  {
    topic: "Portion columns",
    text: "Each of those headers must appear once in the header row. Other columns may sit between a portion's three, and a portion's columns can be anywhere in the row.",
  },
  {
    topic: "Total column",
    text: `The total column is optional. Set TOTAL_HEADER to its header (it must appear once) and ${BRAND.name} keeps it up to date. Leave it out and no total is written, so a total you type yourself will not be kept up to date.`,
  },
  {
    topic: "Month rows",
    text: `Each month has one row. The Month cell is a date or text such as Oct-26, the months are in order, and the row under the last month is empty, so ${BRAND.name} can add the next one there. It reads columns A to ZZ.`,
  },
  {
    topic: "Settings tab",
    text: `${BRAND.name}'s own tab. The headers are in row 1 of columns A to G and the portions are in rows 2 to 50. Each portion has its own id (letters, numbers, - and _), and the Tenant, Count and Amount header texts must match the Schedule's header row. A note typed under the table is ignored.`,
  },
  {
    topic: "Payments Log tab",
    text: `${BRAND.name}'s own tab, used by column position, A to I. If column H or I already has another heading, ${BRAND.name} still writes there (who logged the payment, and what was done) and leaves your heading alone.`,
  },
  {
    topic: "Tenants tab",
    text: `${BRAND.name}'s own tab. It has 15 headers in columns A to O, in a fixed order; capitals and spaces do not matter. Columns to the right of O are yours.`,
  },
  {
    topic: "Naming a tab",
    text: `To give one of ${BRAND.name}'s own tabs another name (SETTINGS_TAB, LOG_TAB, TENANTS_TAB), rename the tab in your Sheet first, then set the variable. A name that is not in your Sheet yet makes ${BRAND.name} start a new tab, with the default values for Settings, and leave your old one alone.`,
  },
  {
    topic: "What the app never does",
    text: `${BRAND.name} adds to your Sheet and never deletes a row, a column or a tab.`,
  },
];
