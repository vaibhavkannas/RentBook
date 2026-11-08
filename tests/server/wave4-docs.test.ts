import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGREEMENT_NOTICE_DAYS, HIKE_NOTICE_MONTHS } from "@/lib/domain/alerts";
import { OVERDUE_GRACE_DAYS, RENT_DUE_DAY } from "@/lib/domain/rent-due";
import { TENANCY_LOG_ACTIONS } from "@/lib/domain/tenancy-log";
import { LAYOUT_RULES } from "@/lib/layout-rules";
import { ordinalDay } from "@/lib/report-copy";
import { TENANCY_LOG_HEADERS } from "@/lib/sheets/tenancy-log-store";
import { HISTORY_SHOWN_LIMIT } from "@/lib/tenancy-history";

/**
 * SETUP.md, README.md and the threat model say what wave 4 built: overdue rent, the year view, agreement and hike alerts, and the
 * Tenancy Log with the History on the tenant page. A doc that drifts from the code is worse than none, so this reads the docs and
 * ties the numbers to the constants the code uses, the labels to the screens, and the claims about the tab to its headers.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const setup = read("SETUP.md");
const readme = read("README.md");
const threat = read("docs/product/THREAT-MODEL.md");

/** The text under a `## heading` of a document, up to the next `## `. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}\n`);
  expect(start, `a section "${heading}"`).toBeGreaterThan(-1);
  const from = start + 1;
  const next = doc.indexOf("\n## ", from + 3);
  return doc.slice(from, next === -1 ? undefined : next);
}

describe("SETUP.md: how the suggested rent is worked out", () => {
  const settings = section(setup, "How the suggested rent is worked out");

  it("says the suggestion is the first payment of the current hike cycle, with the hike when the cycle ends", () => {
    expect(settings).toContain("The suggested rent is the true rent of the current cycle: the amount of its first payment");
    expect(settings).toContain("When a cycle ends, the next payment is suggested with the hike worked from that true rent");
  });

  it("says an amount agreed for one month changes nothing after it, and a first payment is the rent whatever it is", () => {
    expect(settings).toMatch(/A different amount in another month of the cycle .* does not change the suggestion/);
    expect(settings).toMatch(/first payment of a new cycle is the rent of the cycle, rounded or not/);
    expect(settings).not.toMatch(/within ₹ ?10|counts as rounded/);
  });

  it("says a portion whose count never resets keeps following the last payment, and why", () => {
    expect(settings).toMatch(/Count never resets[\s\S]*no hike cycle[\s\S]*follows the last payment/);
  });

  it("says a rent that changes for good in the middle of a cycle shows as a difference until the next cycle", () => {
    expect(settings).toMatch(/changes for good in the middle of a cycle[\s\S]*until the next cycle/);
  });
});

describe("SETUP.md: Overdue rent, the year view and alerts", () => {
  const rent = section(setup, "Overdue rent, the year view and alerts");

  it("names the three screens and the card by the words on the screens, and where to find them", () => {
    const sources: [string, string][] = [
      ["Overdue rent", "src/app/overdue/page.tsx"],
      ["Year at a glance", "src/app/year/page.tsx"],
      ["Agreements and hikes", "src/app/alerts/page.tsx"],
      ["Needs attention", "src/components/AttentionCard.tsx"],
      ["More", "src/app/more/page.tsx"],
    ];
    for (const [label, file] of sources) {
      expect(existsSync(`${ROOT}${file}`), file).toBe(true);
      expect(read(file), `${label} in ${file}`).toContain(label);
      expect(rent, label).toContain(label);
    }
  });

  it("gives the overdue rule in one paragraph, with the days the code uses", () => {
    const paragraph = rent.split("\n\n").find((part) => part.includes("overdue from"));
    expect(paragraph, "a paragraph with the overdue rule").toBeDefined();
    expect(paragraph).toContain(`due on the ${ordinalDay(RENT_DUE_DAY)}`);
    expect(paragraph).toContain(`overdue from the ${ordinalDay(RENT_DUE_DAY + OVERDUE_GRACE_DAYS)}`);
    expect(paragraph).toContain(`${OVERDUE_GRACE_DAYS} days`);
    expect(paragraph).toMatch(/paid ahead/);
    expect(paragraph).toMatch(/vacant/i);
    expect(paragraph).toMatch(/deposit|advance/i);
    expect(paragraph).toMatch(/move-out/);
    // a payment recorded at any amount is paid: only a month with no payment is overdue
    expect(paragraph).toMatch(/overdue only when no payment is recorded for it/);
    expect(paragraph).toMatch(/any payment recorded is never overdue, even if the amount differs from the rent/);
    expect(paragraph).not.toMatch(/part that is missing|paid for less/);
    expect(rent).not.toMatch(/paid short/);
  });

  it("says when an agreement is flagged and when a hike is, with the numbers the code uses", () => {
    expect(rent).toContain(`${AGREEMENT_NOTICE_DAYS} days`);
    expect(rent).toContain(`${HIKE_NOTICE_MONTHS} months`);
    expect(rent).toMatch(/no hike date/i);
  });

  it("says the screens only read, and that a tenant who left shows until the move-out is recorded", () => {
    expect(rent).toMatch(/only read/);
    expect(rent).toMatch(/Record the move-out|record the move-out/);
  });
});

describe("SETUP.md: the Tenancy Log", () => {
  const log = section(setup, "The Tenancy Log");

  it("says what it holds, with its eight headers in order, and that the tenant page shows it as History", () => {
    let at = -1;
    for (const header of TENANCY_LOG_HEADERS) {
      const found = log.indexOf(`\`${header}\``);
      expect(found, header).toBeGreaterThan(at);
      at = found;
    }
    for (const action of TENANCY_LOG_ACTIONS) expect(log, action).toContain(action);
    expect(log).toContain("History");
    expect(log).toContain(`newest ${HISTORY_SHOWN_LIMIT}`);
    expect(log).toMatch(/columns A to H/);
  });

  it("says it is append-only, that phone numbers and notes are recorded only as changed, and that no tenant name is copied", () => {
    expect(log).toMatch(/only adds rows|adds rows and never/);
    expect(log).toMatch(/never edits or deletes/);
    expect(log).toMatch(/Phone/);
    expect(log).toMatch(/Notes/);
    expect(log).toMatch(/only that they changed|only that they were changed/);
    expect(log).toMatch(/no tenant's name|not copied|never copies/i);
  });

  it("says it may be hidden but not renamed or reordered, and that columns to the right of H are the owner's", () => {
    expect(log).toMatch(/hide/i);
    expect(log).toMatch(/not rename/i);
    expect(log).toMatch(/reorder|re-order|move its columns/i);
    expect(log).toMatch(/right of column H/);
  });

  it("says history starts when this version is deployed, and that edits made straight in the Sheet are not recorded", () => {
    expect(log).toMatch(/from then on|from now on|starts when/i);
    expect(log).toMatch(/straight in the Sheet|by hand in the Sheet/);
  });

  it("tells the owner the first page view after deploying adds an empty Tenancy Log tab", () => {
    expect(log).toMatch(/first page view/);
    expect(log).toMatch(/empty `Tenancy Log` tab|empty Tenancy Log tab/);
  });

  it("tells the owner that an existing unrelated tab with this name must be renamed first, or TENANCY_LOG_TAB set", () => {
    expect(log).toMatch(/already has (?:a|another) tab (?:called|named) `?Tenancy Log`?/);
    expect(log).toMatch(/rename (?:that tab|it)[^.]*before you deploy/);
    expect(log).toContain("`TENANCY_LOG_TAB`");
    expect(log).toMatch(/bottom of that tab|below what is already there/);
  });

  it("says an undo that opens a tenancy again is recorded as an Edited row for the Move-out date", () => {
    expect(log).toMatch(/Undo[^.]*opens a tenancy again[^.]*Edited[^.]*Move-out date/);
  });

  it("says what a missing history entry means: the change is saved, and a message says the entry could not be added", () => {
    expect(log).toContain("The change was saved, but it couldn't be added to the History.");
  });
});

describe("SETUP.md: Prepare my Sheet and the Tenancy Log", () => {
  const check = section(setup, "Check your setup in the app");

  it("lists the Tenancy Log among the tabs Prepare my Sheet adds, and says it also adds it on the first page view", () => {
    expect(check).toMatch(/Settings, Payments Log, Tenants or Tenancy Log/);
  });
});

describe("the layout rule for the Tenancy Log tab", () => {
  it("is in LAYOUT_RULES between the Tenants tab and Naming a tab, and says what the tab is", () => {
    const topics = LAYOUT_RULES.map((rule) => rule.topic);
    expect(topics.indexOf("Tenancy Log tab")).toBe(topics.indexOf("Tenants tab") + 1);
    expect(topics.indexOf("Naming a tab")).toBe(topics.indexOf("Tenancy Log tab") + 1);
    const text = LAYOUT_RULES.find((rule) => rule.topic === "Tenancy Log tab")!.text;
    expect(text).toContain(`${TENANCY_LOG_HEADERS.length} headers`);
    expect(text).toContain("columns A to H");
    expect(text).toMatch(/only adds rows/);
    expect(text).toMatch(/hidden/);
    expect(text).toMatch(/not renamed|not be renamed/);
  });
});

describe("README.md: the wave 4 features", () => {
  const features = readme.slice(0, readme.indexOf("## Develop"));

  it("lists overdue rent, the year at a glance, agreement and hike alerts and the tenancy history", () => {
    expect(features).toMatch(/Overdue rent/);
    expect(features).toMatch(/Year at a glance/);
    expect(features).toMatch(/agreement/i);
    expect(features).toMatch(/hike/i);
    expect(features).toMatch(/Tenancy Log/);
    expect(features).toMatch(/History/);
  });

  it("says what the history records, including a tenancy a New tenant closes and one an undo opens again", () => {
    const bullet = features.split("\n").find((line) => line.startsWith("- Tenancy history:"))!;
    expect(bullet).toMatch(/closed by a new tenant/);
    expect(bullet).toMatch(/opened again by an undo/);
    expect(bullet).toMatch(/made in the app/);
  });

  it("mentions the Tenancy Log in the verify:testcopy row, since the script now checks it", () => {
    const row = readme.split("\n").find((line) => line.startsWith("| `npm run verify:testcopy`"))!;
    expect(row).toContain("Tenancy Log");
  });
});

describe("the threat model", () => {
  it("says what the Tenancy Log records and what it does not copy", () => {
    expect(threat).toContain(
      "The Tenancy Log records who changed tenancy details and when; phone numbers and notes are not copied into it.",
    );
  });

  it("lists the Tenancy Log among the tabs that hold tenant data, and the history retry among the routes that change something", () => {
    const assets = threat.slice(threat.indexOf("## What is worth protecting"), threat.indexOf("## Who is involved"));
    expect(assets).toContain("Tenancy Log");
    const requests = threat.slice(threat.indexOf("### Requests to the API"), threat.indexOf("### Signed values"));
    expect(requests).toContain("`/api/tenancies/history-retry`");
  });

  it("says the history retry token works like the payment one, and what the Tenancy Log's own failures are called in the log", () => {
    const signed = threat.slice(threat.indexOf("### Signed values"), threat.indexOf("### Browser hardening"));
    expect(signed).toMatch(/history retry token|Tenancy Log retry token/i);
    for (const event of ["tenancy-log-append-failed", "tenancy-log-check-failed", "tenancy-log-read-failed"]) {
      expect(threat, event).toContain(event);
    }
  });

  it("says a history row can fail to save or be added twice in a rare race, in the limits that remain", () => {
    const limits = threat.slice(threat.indexOf("## Limits that remain"), threat.indexOf("## Before a commercial launch"));
    expect(limits).toMatch(/Tenancy Log/);
    expect(limits).toMatch(/twice|duplicate/);
  });

  it("says in the limits that an undo which opens a tenancy again is recorded as an edit, and what is not recorded", () => {
    const limits = threat.slice(threat.indexOf("## Limits that remain"), threat.indexOf("## Before a commercial launch"));
    const bullet = limits.split("\n").find((line) => line.startsWith("- The Tenancy Log is a convenience"))!;
    expect(bullet).toMatch(/undo that opens a tenancy again is recorded as an Edited row for its Move-out date/);
    expect(bullet).toMatch(/straight in the Sheet/);
  });
});
