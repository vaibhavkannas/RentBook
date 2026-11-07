import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGREEMENT_NOTICE_DAYS, HIKE_NOTICE_MONTHS } from "@/lib/domain/alerts";
import { HIKE_ROUNDING_ALLOWANCE } from "@/lib/domain/rent-rules";
import { OVERDUE_GRACE_DAYS, RENT_DUE_DAY } from "@/lib/domain/rent-due";
import { ACTIVITY_SHOWN_LIMIT } from "@/lib/activity-view";
import { CONNECTION_NEEDS_ATTENTION, crossOriginRequest, PAGE_OUT_OF_DATE_MESSAGE, rateLimited, tabMissing, UNREADABLE_REQUEST_MESSAGE, unavailable } from "@/lib/errors";
import { formatRupees } from "@/lib/format";
import { HISTORY_NOT_SAVED } from "@/lib/history-retry";
import { LATER_ENTRY_REASON } from "@/lib/domain/month-view";
import {
  LOG_RETRY_FAILED_MESSAGE,
  LOG_RETRY_UNCONFIRMED_MESSAGE,
  LOG_RETRY_UNUSABLE_MESSAGE,
  TENANCY_NOT_SAVED_MESSAGE,
} from "@/lib/payment-request";
import { POST_TIMEOUT_MS } from "@/lib/post-json";
import { ordinalDay, YEAR_LEGEND } from "@/lib/report-copy";
import {
  OFFLINE_MESSAGE,
  PAYMENT_NO_CONFIRMATION,
  PORTION_NO_CONFIRMATION,
  PREPARE_NO_CONFIRMATION,
  SETTINGS_NO_CONFIRMATION,
  SIGNED_OUT_MESSAGE,
  SOMETHING_WENT_WRONG_MESSAGE,
  TIMEOUT_MESSAGE,
  UNDO_NO_CONFIRMATION,
} from "@/lib/request-copy";
import { translateGoogleError } from "@/lib/sheets/google-errors";
import { TENANCY_CONFLICT_MESSAGE } from "@/lib/tenancy-response";
import { UNDO_CONFLICT_MESSAGE } from "@/lib/undo-copy";

/**
 * USER-GUIDE.md and TROUBLESHOOTING.md are short, plain and written for the owner and the people they added. A guide that
 * drifts from the screens is worse than none, so this reads both: every message TROUBLESHOOTING quotes is found in the code
 * (and the ones the code builds at run time are compared with what it builds), every bold label occurs in the source, and
 * the numbers in the guide are the ones the code uses.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const guide = read("docs/USER-GUIDE.md");
const trouble = read("docs/TROUBLESHOOTING.md");
const readme = read("README.md");

/**
 * Everything under src as one text, as the words would be searched for: the entities JSX writes for a quote are the quote, a
 * string cut in two and joined with + is one string, and an escaped quote is a quote.
 */
const source = (() => {
  const files = (readdirSync(path.join(ROOT, "src"), { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file));
  return files
    .map((file) => read(path.join("src", file)))
    .join("\n")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\\(["'])/g, "$1")
    .replace(/(["'`])\s*\+\s*\1/g, "");
})();

/** The text under a `## heading` of a doc, up to the next `## `. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}\n`);
  expect(start, `a section "${heading}"`).toBeGreaterThan(-1);
  const next = doc.indexOf("\n## ", start + 4);
  return doc.slice(start + 1, next === -1 ? undefined : next);
}

/** The lines of a doc that quote a message: `> "text"`. */
const quotes = (doc: string) => [...doc.matchAll(/^> "(.*)"$/gm)].map((match) => match[1]);

/** The first sentence of a message: up to the first full stop, question mark or exclamation mark that ends a word, or all of it. */
const firstSentence = (message: string) => /^(.*?[.!?])(?:\s|$)/.exec(message)?.[1] ?? message;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pattern that finds `sentence` in the source. A `{placeholder}` stands for whatever the code puts there, so does the
 * brand's name, and a number may be the code's own computed one.
 */
function sourcePattern(sentence: string): RegExp {
  const parts = sentence.split(/(\{[^}]*\})/).map((part) => {
    if (part.startsWith("{") && part.endsWith("}")) return "[^\\n]*?";
    return escapeRegExp(part)
      .replace(/RentBook/g, "[^\\n]*?")
      .replace(/\d+/g, "(?:\\d+|\\$\\{[^}]*\\})");
  });
  return new RegExp(parts.join(""));
}

describe("TROUBLESHOOTING.md: the messages it quotes", () => {
  const lines = quotes(trouble);

  it("quotes a good many, each on a line of its own", () => {
    expect(lines.length).toBeGreaterThanOrEqual(40);
  });

  it.each(lines.map((line) => [line]))("has the first sentence of %s in the code", (line) => {
    const sentence = firstSentence(line);
    expect(sentence.length, "a sentence").toBeGreaterThan(10);
    expect(sourcePattern(sentence).test(source), `"${sentence}" is not in src`).toBe(true);
  });

  it("quotes nothing twice", () => {
    expect(new Set(lines).size).toBe(lines.length);
  });

  describe("quotes, word for word, the messages the code builds", () => {
    // The code builds these at run time (a hint is added, a number is worked out), so they are compared with what it builds.
    const first = (message: string) => firstSentence(message);
    const built: Array<[string, string]> = [
      ["the connection message for a member", CONNECTION_NEEDS_ATTENTION],
      ["Google not responding", unavailable().message],
      ["Google limiting requests", rateLimited().message],
      ["a missing tab", tabMissing("{tab}").message],
      ["a page out of date", PAGE_OUT_OF_DATE_MESSAGE],
      ["a request that could not be read", UNREADABLE_REQUEST_MESSAGE],
      ["a request from another page", crossOriginRequest().message],
      ["offline", OFFLINE_MESSAGE],
      ["no answer", TIMEOUT_MESSAGE],
      ["a payment without confirmation", PAYMENT_NO_CONFIRMATION],
      ["an undo without confirmation", UNDO_NO_CONFIRMATION],
      ["a portion change without confirmation", PORTION_NO_CONFIRMATION],
      ["Prepare my Sheet without confirmation", PREPARE_NO_CONFIRMATION],
      ["settings without an answer", SETTINGS_NO_CONFIRMATION],
      ["being signed out", SIGNED_OUT_MESSAGE],
      ["an unexpected error", SOMETHING_WENT_WRONG_MESSAGE],
      ["a tenancy conflict", TENANCY_CONFLICT_MESSAGE],
      ["an undo conflict", UNDO_CONFLICT_MESSAGE],
      ["a later entry", LATER_ENTRY_REASON],
      ["a history that did not save", HISTORY_NOT_SAVED],
      ["tenancy details that did not save", TENANCY_NOT_SAVED_MESSAGE],
      ["a failed log retry", LOG_RETRY_FAILED_MESSAGE],
      ["an unconfirmed log retry", LOG_RETRY_UNCONFIRMED_MESSAGE],
      ["an unusable log retry", LOG_RETRY_UNUSABLE_MESSAGE],
    ];
    const google = (status: number, message = "", email?: string) =>
      (translateGoogleError({ status, message }, email) as Error).message;
    built.push(
      ["a rejected key", google(401)],
      ["a missing API", google(403, "Google Sheets API has not been used in project 1 before or it is disabled")],
      ["no access", google(403, "The caller does not have permission", "{the service account's address}")],
      ["an Excel file", google(400, "This operation is not supported for this document")],
      ["a Sheet that is not there", google(404)],
    );

    it.each(built)("%s", (_what, message) => {
      const sentence = first(message);
      // a message that carries a changing part is quoted with a placeholder in its place: compare up to it
      const wanted = sentence.replace(/ \(The caller does not have permission\)/, "{ (details)}");
      expect(lines.some((line) => first(line) === wanted), `"${wanted}" is quoted`).toBe(true);
    });

    it("says the wait a request is given in seconds, as the code has it", () => {
      expect(TIMEOUT_MESSAGE.startsWith(`No answer after ${POST_TIMEOUT_MS / 1000} seconds.`)).toBe(true);
      expect(trouble).toContain(`No answer after ${POST_TIMEOUT_MS / 1000} seconds. It may still have saved.`);
    });
  });

  it("gives SESSION_NOT_BEFORE's form as the code and Set up give it", () => {
    expect(trouble).toContain("`2026-10-16T10:00:00Z`");
    expect(Number.isNaN(Date.parse("2026-10-16T10:00:00Z"))).toBe(false);
    expect(source).toContain("2026-10-16T10:00:00Z");
    expect(source).toContain("Not a date and time, so everyone is signed out.");
    expect(source).toContain("SESSION_NOT_BEFORE is not a date and time (for example 2026-10-16T10:00:00Z), so every session is refused.");
  });

  it("covers what the brief asks of it, in the sections it asks for", () => {
    for (const heading of ["Start here", "Signing in", "The Sheet", "Saving", "If a page is blank or a button does nothing"]) {
      expect(trouble, heading).toContain(`## ${heading}`);
    }
    expect(trouble).toContain("CSP_REPORT_ONLY");
    expect(trouble).toMatch(/delete the variable/);
    expect(trouble).toContain("`/api/health`");
    expect(trouble).toContain("`requestId`");
  });
});

describe("the bold words of both guides are words on the screens", () => {
  for (const [name, doc] of [["USER-GUIDE.md", guide], ["TROUBLESHOOTING.md", trouble]] as const) {
    const labels = [...new Set([...doc.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]))];

    it(`${name} has some`, () => {
      expect(labels.length).toBeGreaterThan(10);
    });

    it.each(labels.map((label) => [label]))(`${name}: **%s** is in src`, (label) => {
      expect(source.includes(label), `"${label}" is not in src`).toBe(true);
    });
  }
});

describe("USER-GUIDE.md", () => {
  it("is one to two pages: under 1,300 words", () => {
    const words = guide.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThan(500);
    expect(words).toBeLessThan(1300);
  });

  it("goes through the subjects in order: signing in to adding the app to the home screen", () => {
    const headings = [...guide.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      "Signing in",
      "The month screen",
      "Logging a payment",
      "Tenant details and moving out",
      "Activity",
      "Overdue rent, Year at a glance, and Agreements and hikes",
      "Portion settings",
      "Set up and Diagnostics",
      "Adding the app to the home screen",
    ]);
  });

  it("gives the overdue rule with the days the code uses, and says what never counts", () => {
    expect(guide).toContain(`due on the ${ordinalDay(RENT_DUE_DAY)} and counts as overdue from the ${ordinalDay(RENT_DUE_DAY + OVERDUE_GRACE_DAYS)}`);
    expect(OVERDUE_GRACE_DAYS).toBe(5);
    expect(guide).toContain("five days later");
    const paragraph = guide.split("\n\n").find((part) => part.includes("counts as overdue"));
    expect(paragraph).toMatch(/Only the current tenant/);
    expect(paragraph).toMatch(/Vacant months, months paid ahead and the advance are never counted/);
    expect(paragraph).toMatch(/until you record the move-out/);
  });

  it("gives the alert windows, the rounding allowance, the Activity limit and the sign-in's length as the code has them", () => {
    expect(guide).toContain(`end within ${AGREEMENT_NOTICE_DAYS} days`);
    expect(guide).toContain(`within the next ${HIKE_NOTICE_MONTHS} months`);
    // the app writes a rupee amount with a no-break space; the guide, read as plain text, with an ordinary one
    expect(guide).toContain(`within ${formatRupees(HIKE_ROUNDING_ALLOWANCE).replace(/\s/g, " ")} of the hike`);
    expect(guide).toContain(`newest ${ACTIVITY_SHOWN_LIMIT} that match`);
    expect(guide).toContain("seven days");
  });

  it("names every mark of the year view's key", () => {
    for (const { label } of YEAR_LEGEND) expect(guide, label).toContain(`**${label}**`);
  });

  it("links to the troubleshooting guide", () => {
    expect(guide).toContain("[TROUBLESHOOTING.md](TROUBLESHOOTING.md)");
  });
});

describe("README.md", () => {
  it("links both guides", () => {
    expect(readme).toContain("(docs/USER-GUIDE.md)");
    expect(readme).toContain("(docs/TROUBLESHOOTING.md)");
  });

  it("lists the guides: user guide, troubleshooting, setup, security and the threat model", () => {
    const guides = section(readme, "Guides");
    for (const link of ["docs/USER-GUIDE.md", "docs/TROUBLESHOOTING.md", "SETUP.md", "SECURITY.md", "docs/product/THREAT-MODEL.md"]) {
      expect(guides, link).toContain(`(${link})`);
    }
  });

  it("has the e2e command in its table of commands, and an End-to-end check that says what it is and that CI does not run it", () => {
    expect(readme).toMatch(/\| `npm run e2e` \|/);
    const check = section(readme, "End-to-end check");
    expect(check.length).toBeGreaterThan(200);
    expect(check).toContain("npm run e2e");
    expect(check).toMatch(/in-memory Sheet/);
    expect(check).toMatch(/never reaches Google/);
    expect(check).toMatch(/outside the project/);
    expect(check).toMatch(/not run in CI/);
    for (const flag of ["--keep", "--only", "--shots"]) expect(check, flag).toContain(flag);
  });

  it("no longer says how many portions there are", () => {
    expect(readme.split("\n").find((line) => line.length > 0 && !line.startsWith("#"))).not.toMatch(/five portions/i);
    expect(readme).not.toMatch(/five portions/i);
  });
});

describe("SETUP.md", () => {
  it("sends a reader whose sign-in fails to the troubleshooting guide", () => {
    expect(section(read("SETUP.md"), "If sign-in fails")).toContain("(docs/TROUBLESHOOTING.md)");
  });
});

describe("the new guides' addresses", () => {
  it.each([["USER-GUIDE.md", guide], ["TROUBLESHOOTING.md", trouble]])("%s holds no address other than at example.com", (_name, doc) => {
    const addresses = doc.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    for (const address of addresses) expect(address.endsWith("@example.com"), address).toBe(true);
  });

  it("hold no secret-looking value either", () => {
    for (const doc of [guide, trouble]) {
      expect(doc).not.toMatch(/-----BEGIN|AUTH_SECRET=\S|AIza[0-9A-Za-z_-]{20}|GOCSPX-/);
    }
  });
});
