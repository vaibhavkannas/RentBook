import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGREEMENT_NOTICE_DAYS, HIKE_NOTICE_MONTHS } from "@/lib/domain/alerts";
import { OVERDUE_GRACE_DAYS, RENT_DUE_DAY } from "@/lib/domain/rent-due";
import { ACTIVITY_SHOWN_LIMIT } from "@/lib/activity-view";
import { CONNECTION_NEEDS_ATTENTION, crossOriginRequest, PAGE_OUT_OF_DATE_MESSAGE, rateLimited, tabMissing, UNREADABLE_REQUEST_MESSAGE, unavailable } from "@/lib/errors";
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
import { isSessionCurrent } from "@/lib/server/session-policy";
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

/**
 * Whether `label` is text of its own in the source, as a screen shows it: a whole string in quotes, or JSX text that begins and
 * ends at a tag or an expression (`>Log payment<`, `>Round to {amount}`). A word inside a longer string or sentence is not one,
 * so "Keep" or "Edit" cannot be found by chance in any text of src.
 */
function isScreenText(label: string): boolean {
  const text = escapeRegExp(label);
  return new RegExp(`(["'\`])${text}\\1|>\\s*${text}\\s*[<{]`).test(source);
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

  it("gives SESSION_NOT_BEFORE's form as the code gives it", () => {
    expect(trouble).toContain("`2026-10-16T10:00:00Z`");
    expect(Number.isNaN(Date.parse("2026-10-16T10:00:00Z"))).toBe(false);
    expect(source).toContain("2026-10-16T10:00:00Z");
    expect(source).toContain("SESSION_NOT_BEFORE is not a date and time (for example 2026-10-16T10:00:00Z), so every session is refused.");
  });

  it("says SESSION_NOT_BEFORE must be now or earlier, because the code refuses a new sign-in made before a time in the future", () => {
    const now = Date.parse("2026-11-07T10:00:00Z");
    const future = "2026-11-07T11:00:00Z";
    // a sign-in made now, against a cut-off an hour ahead: refused (the owner included)
    expect(isSessionCurrent(now, future, now)).toBe(false);
    // against a cut-off that is now or earlier: fine
    expect(isSessionCurrent(now, "2026-11-07T10:00:00Z", now)).toBe(true);
    expect(isSessionCurrent(now, "2026-11-07T09:00:00Z", now)).toBe(true);
    const entry = trouble.slice(trouble.indexOf("`SESSION_NOT_BEFORE` is the"), trouble.indexOf("## The Sheet"));
    expect(entry).toContain("It must be now or earlier.");
    expect(entry).toMatch(/A time in the future refuses every sign-in made before it, new ones too, so everyone, the owner included/);
    expect(entry).toContain("Leaving a value that is now or earlier in place is fine");
    expect(entry).not.toMatch(/you may leave it in place/i);
    expect(section(read("SETUP.md"), "Signing everyone out")).toContain("Do not set a time in the future");
  });

  it("does not send a person who cannot sign in to Set up, which they cannot open then", () => {
    // while a sign-in setting is missing, getViewer throws before it reads a session, and a signed-out person is sent to /signin
    expect(read("src/lib/server/auth-guard.ts")).toMatch(/assertAuthConfig\(process\.env\);\s*const session = await auth\(\)/);
    expect(read("src/app/setup/page.tsx")).toMatch(/const viewer = await getViewer\(\);\s*if \(!viewer\) redirect\("\/signin"\)/);
    // an unreadable SESSION_NOT_BEFORE refuses every session, so nobody is signed in to open Set up either
    expect(isSessionCurrent(Date.now(), "not a date", Date.now())).toBe(false);
    const entry = section(trouble, "Signing in");
    const settingsEntry = entry.slice(entry.indexOf("> \"Sign-in isn't set up correctly."), entry.indexOf("> \"Sign-in didn't work."));
    expect(settingsEntry).toContain("nobody can sign in, so **Set up** cannot be opened");
    expect(settingsEntry).not.toMatch(/Set up\*\* lists which/);
    expect(entry).toContain("Nobody can open **Set up** while everyone is signed out, so the log is where to look.");
    expect(entry).not.toMatch(/\*\*Set up\*\* shows/);
    // the log lines it names are the ones the code writes, and the messages it quotes name the setting and never its value
    expect(read("src/instrumentation.ts")).toContain('"request-error"');
    expect(read("src/lib/server/auth-log.ts")).toContain('"auth-error"');
    expect(source).toContain("`${name} is missing.`");
    expect(source).toContain("AUTH_SECRET is missing.");
    expect(settingsEntry).toContain("`request-error`");
    expect(settingsEntry).toContain("`auth-error`");
  });

  it("says what is true of undoing a vacancy: undoing a New tenant reopens, a Move out has no undo", () => {
    const setup = read("SETUP.md");
    expect(setup).toContain("It never reopens a move-out you recorded with Move out");
    expect(setup).toContain("Undo of a New tenant's first payment reopens what that request closed");
    const refusal = trouble.slice(trouble.indexOf("> \"{portion} is vacant in"), trouble.indexOf("> \"{portion} is switched off"));
    expect(refusal).toContain("undoing that New tenant's first payment opens them again");
    expect(refusal).toContain("The app has no undo for a move-out recorded with **Move out** on the tenant page");
    expect(refusal).toContain("tap **Add details** for the same tenant");
    expect(refusal).not.toMatch(/undo the New tenant that caused it/);
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

    it.each(labels.map((label) => [label]))(`${name}: **%s** is a screen's own text in src`, (label) => {
      expect(isScreenText(label), `"${label}" is not a button, heading or label of its own in src`).toBe(true);
    });
  }

  it("finds a whole label and not a part of a longer one", () => {
    expect(isScreenText("Log payment")).toBe(true);
    expect(isScreenText("Keep")).toBe(true);
    expect(isScreenText("Round to")).toBe(true);
    expect(isScreenText("Log paym")).toBe(false);
    expect(isScreenText("Sign in with")).toBe(false);
    expect(isScreenText("Replace amou")).toBe(false);
    expect(isScreenText("Undo payment")).toBe(true);
  });
});

describe("USER-GUIDE.md", () => {
  it("is one to two pages: under 1,500 words", () => {
    const words = guide.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThan(500);
    expect(words).toBeLessThan(1500);
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
    // a payment recorded at any amount (one agreed with the tenant, say) is paid: it is never overdue or short
    expect(paragraph).toMatch(/A month is overdue only when no payment is recorded for it/);
    expect(paragraph).toMatch(/any payment recorded is never overdue, even if the amount is not the usual rent/);
    expect(paragraph).not.toMatch(/part that is missing|paid for less/);
    expect(paragraph).toMatch(/Vacant months, months paid ahead and the advance are never counted/);
    expect(paragraph).toMatch(/until you record the move-out/);
  });

  it("gives the alert windows, the Activity limit and the sign-in's length as the code has them", () => {
    expect(guide).toContain(`end within ${AGREEMENT_NOTICE_DAYS} days`);
    expect(guide).toContain(`within the next ${HIKE_NOTICE_MONTHS} months`);
    expect(guide).toContain(`newest ${ACTIVITY_SHOWN_LIMIT} that match`);
    expect(guide).toContain("seven days");
  });

  it("explains the suggested rent in plain words: the first payment of the hike cycle is the rent, and any other amount is agreed for its month", () => {
    expect(guide).toContain("The rent RentBook suggests is the first payment of the current hike cycle.");
    expect(guide).toContain("A different amount in another month is treated as agreed for that month: it does not change the suggestion and is never overdue.");
    expect(guide).toContain("After a hike, the first payment you log is taken as the new rent, rounded or not.");
    expect(guide).toContain("count never resets, the suggestion follows the last payment");
    expect(guide).toContain("RentBook asks you to confirm one far from the suggestion");
    expect(guide).toMatch(/Overdue counts unpaid months at the old rent and the next hike is worked from it/);
    // the old rule, a few rupees of allowance, is gone
    expect(guide).not.toMatch(/within ₹ ?10|counts as rounded|as extra or short/);
  });

  it("names every mark of the year view's key", () => {
    for (const { label } of YEAR_LEGEND) expect(guide, label).toContain(`**${label}**`);
    expect(guide).not.toContain("Part paid");
    expect(guide).toMatch(/a month with a payment recorded is \*\*Paid\*\* whatever the amount/);
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
    expect(check).toMatch(/never reaches the Google Sheets API or any Google account/);
    expect(check).not.toMatch(/never reaches Google\b/);
    expect(check).toMatch(/downloads the Inter and Space Grotesk fonts from Google Fonts/);
    expect(check).toMatch(/signed in with cookies the run makes itself/);
    expect(check).toContain("the sign-in page");
    expect(check).not.toMatch(/journeys: signing in/);
    expect(check).toMatch(/deleted when the run ends, Ctrl-C included, unless a check failed or you gave `--keep`/);
    expect(check).toMatch(/The server never outlives the run: a small watchdog beside it ends it if the run is killed hard/);
    // ... and the runner does what the paragraph says
    const runner = read("scripts/e2e/run.ts");
    expect(runner).toContain("SIGNALS");
    expect(runner).toContain("watched(process.pid");
    expect(runner).toContain("handleSIGINT: false");
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
  it("says Set up, Diagnostics and Prepare my Sheet are the owner's, as Portion settings are, and the code agrees", () => {
    const setup = read("SETUP.md");
    expect(setup).toContain("Only the first address in `ALLOWED_EMAILS` (the owner) can change Portion settings. Set up, Diagnostics and Prepare my Sheet are the owner's too.");
    expect(read("src/app/setup/page.tsx")).toContain("if (!viewer.isOwner)");
    expect(read("src/app/diagnostics/page.tsx")).toContain("if (!viewer.isOwner)");
    expect(read("src/app/settings/page.tsx")).toContain("if (!viewer.isOwner) redirect");
    expect(read("src/app/api/setup/prepare/route.ts")).toContain("requireOwner");
  });

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
