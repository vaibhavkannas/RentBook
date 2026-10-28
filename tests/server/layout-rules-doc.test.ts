import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAYOUT_RULES } from "@/lib/layout-rules";
import { SWITCH_OFF_RULE } from "@/lib/portion-requests";
import { SETUP_STEPS } from "@/lib/setup-checks";
import { ACTIVE_HEADER, DEFAULT_CYCLE_LENGTH, DEFAULT_HIKE_PERCENT } from "@/lib/sheets/settings-store";
import { MAX_PORTIONS } from "@/lib/sheets/portion-plan";
import { APP_TABS, DEFAULT_TAB_NAMES, TAB_VARIABLES } from "@/lib/sheets/tab-names";
import { MAX_TAB_NAME_LENGTH } from "@/lib/server/env";

/**
 * SETUP.md, README.md and the threat model say what wave 3 built: the Set up page, Diagnostics, vacant portions, and adding,
 * switching off and reordering portions. A doc that drifts from the code is worse than none, so this reads the docs and ties
 * each claim that can be tied to the code or the screens: every line of LAYOUT_RULES is in SETUP.md, the names of the settings
 * are the real ones, the labels the docs tell a person to tap are in the source, and the old sentences that stopped being true
 * are gone.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const setup = read("SETUP.md");
const readme = read("README.md");
const threat = read("docs/product/THREAT-MODEL.md");
const envExample = read(".env.example");

/** The text under a `## heading` of a document, up to the next `## `. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}\n`);
  expect(start, `a section "${heading}"`).toBeGreaterThan(-1);
  const from = start + 1;
  const next = doc.indexOf("\n## ", from + 3);
  return doc.slice(from, next === -1 ? undefined : next);
}

/** The line of the settings table of SETUP.md that starts with this name. */
function tableRow(name: string): string {
  const row = setup.split("\n").find((line) => line.startsWith(`| \`${name}\``) || line.startsWith(`| ${name} `));
  expect(row, `a table row for ${name}`).toBeDefined();
  return row!;
}

describe("SETUP.md: Your Sheet's layout", () => {
  const layout = section(setup, "Your Sheet's layout");

  it("says every line of LAYOUT_RULES, word for word, under its heading, in the order the Set up page lists them", () => {
    let at = -1;
    for (const { topic, text } of LAYOUT_RULES) {
      const found = layout.indexOf(text);
      expect(found, `the rule "${topic}"`).toBeGreaterThan(-1);
      expect(layout.slice(Math.max(0, found - topic.length - 8), found), topic).toContain(topic);
      expect(found, `${topic} after the rule before it`).toBeGreaterThan(at);
      at = found;
    }
  });

  it("points to the Set up page, where the same list is, and to the checks in the app", () => {
    expect(layout).toContain("What your Sheet needs");
    expect(layout).toContain("Set up");
  });
});

describe("SETUP.md: the settings", () => {
  it("says TOTAL_HEADER is optional, what it does when it is set, and what happens without it", () => {
    const row = tableRow("TOTAL_HEADER");
    expect(row).toMatch(/Optional/);
    expect(row).toMatch(/no total/i);
    expect(row).toMatch(/go(?:es)? out of date|stale/i);
    expect(row).not.toMatch(/No default: it must match/);
    expect(setup).not.toMatch(/TOTAL_HEADER[^\n]*required/i);
  });

  it("lists SETTINGS_TAB, LOG_TAB and TENANTS_TAB as optional, with the names the app uses when they are left out", () => {
    for (const tab of APP_TABS) {
      const variable = TAB_VARIABLES[tab];
      const row = tableRow(variable);
      expect(row, variable).toMatch(/Optional/);
      expect(row, variable).toContain(`\`${DEFAULT_TAB_NAMES[tab]}\``);
    }
    expect(Object.values(TAB_VARIABLES)).toEqual(["SETTINGS_TAB", "LOG_TAB", "TENANTS_TAB"]);
  });

  it("says to rename your own tab in the Sheet first, then set the variable, and why: a name that is not there yet starts a new tab with default values", () => {
    const env = section(setup, "6. Create `.env.local`");
    expect(env).toMatch(/rename your own tab in your Sheet first, then set the variable/i);
    expect(env).toMatch(/first page view/);
    expect(env).toContain("Prepare my Sheet");
    expect(env).toContain(`${DEFAULT_CYCLE_LENGTH} payments per cycle and a ${DEFAULT_HIKE_PERCENT}% hike`);
    expect(env).toContain(`${MAX_TAB_NAME_LENGTH} characters`);
    expect(env).toMatch(/each name a different tab|must all be different/);
    expect(tableRow("SCHEDULE_TAB")).toMatch(/capitals or spaces/);
  });

  it("gives the rename advice for the Tenants tab as renaming it or setting TENANTS_TAB", () => {
    const before = section(setup, "Tenant details");
    expect(before).toMatch(/rename that tab before you deploy[^.]*or set `TENANTS_TAB`/);
  });

  it("tells Vercel users to add the optional names too, when they use them", () => {
    const deploy = section(setup, "7. Deploy to Vercel");
    for (const name of ["TOTAL_HEADER", "SETTINGS_TAB", "LOG_TAB", "TENANTS_TAB"]) expect(deploy).toContain(name);
  });

  it("has .env.example name the three tab settings and show TOTAL_HEADER as optional", () => {
    for (const variable of Object.values(TAB_VARIABLES)) expect(envExample, variable).toMatch(new RegExp(`^# ${variable}=`, "m"));
    expect(envExample).toMatch(/^# TOTAL_HEADER=/m);
    expect(envExample).not.toMatch(/^TOTAL_HEADER=/m);
    expect(envExample).toMatch(/optional/i);
    expect(envExample).toMatch(/rename/i);
  });
});

describe("SETUP.md: Check your setup in the app", () => {
  const check = section(setup, "Check your setup in the app");

  it("names the screens: More, Set up, Prepare my Sheet and Diagnostics, and says Set up only reads until Prepare is tapped", () => {
    for (const label of ["More", "Set up", "Prepare my Sheet", "Diagnostics", "Check again"]) expect(check, label).toContain(label);
    expect(check).toMatch(/only reads/);
  });

  it("lists the six steps by the names the page gives them, in order", () => {
    let at = -1;
    for (const { step, title } of SETUP_STEPS) {
      const found = check.indexOf(`${step}. ${title}`);
      expect(found, `step ${step}`).toBeGreaterThan(at);
      at = found;
    }
    expect(SETUP_STEPS).toHaveLength(6);
  });

  it("says what Prepare my Sheet adds, what it fills in, the defaults it starts Settings with, and that it never changes a filled cell", () => {
    expect(check).toMatch(/adds the missing tabs/i);
    expect(check).toMatch(/starts Settings from your Schedule/i);
    expect(check).toContain(`${DEFAULT_CYCLE_LENGTH} payments per cycle and a ${DEFAULT_HIKE_PERCENT}% hike`);
    expect(check).toMatch(/never changes a cell that already holds something/);
    expect(check).toMatch(/never deletes/);
  });

  it("says the pages show no secret, key, token or tenant data, only counts, times and tab names", () => {
    expect(check).toMatch(/no secret/i);
    expect(check).toMatch(/tenant/i);
    expect(check).toMatch(/counts/);
  });

  it("says who may open them: the owner", () => {
    expect(check).toMatch(/owner/);
  });
});

describe("SETUP.md: Adding, switching off and reordering portions", () => {
  const portions = section(setup, "Adding, switching off and reordering portions");

  it("names the buttons a person taps, as the screen words them", () => {
    for (const label of ["Portion settings", "Add a portion", "Add portion", "Switch off", "Switch on", "Change order", "Save order", "Switched off"]) {
      expect(portions, label).toContain(label);
    }
  });

  it("says where a new portion's columns go and what it adds, and that a Total formula is never edited", () => {
    expect(portions).toMatch(/to the right of everything/);
    expect(portions).toContain("Tenant6");
    expect(portions).toMatch(/row (?:in|to) the Settings tab/);
    expect(portions).toMatch(/never edits a Total formula/);
    expect(portions).toContain(`${MAX_PORTIONS} portions`);
  });

  it("says when a portion can be switched off, in the words of the screen, and that its history stays", () => {
    expect(portions).toContain(SWITCH_OFF_RULE);
    expect(portions).toMatch(/history stays/);
  });

  it("says the Active column is H of the Settings tab, and the owner's step before using it: H1 blank and column H empty", () => {
    expect(ACTIVE_HEADER).toBe("Active");
    expect(portions).toContain('"Active"');
    expect(portions).toMatch(/column H/);
    expect(portions).toMatch(/H1 is blank/);
    expect(portions).toMatch(/OWNER STEP|Before you use it/i);
  });

  it("says what is not supported: deleting a portion or its history, renaming or moving its columns, changing its id, editing a Total formula", () => {
    const not = portions.slice(portions.indexOf("not supported"));
    expect(not).toMatch(/deleting a portion/i);
    expect(not).toMatch(/history/);
    expect(not).toMatch(/renaming/i);
    expect(not).toMatch(/moving/i);
    expect(not).toMatch(/\bid\b/);
    expect(not).toMatch(/Total formula/);
  });

  it("gives the safe order to remove a portion completely: switch it off, delete its three columns only if its history is not wanted (keep a copy), then delete its Settings row", () => {
    const order = portions.slice(portions.indexOf("remove a portion"));
    const off = order.indexOf("Switch it off");
    const columns = order.indexOf("three columns");
    const row = order.indexOf("Settings row");
    expect(off).toBeGreaterThan(-1);
    expect(columns).toBeGreaterThan(off);
    expect(row).toBeGreaterThan(columns);
    expect(order).toMatch(/copy/i);
  });
});

describe("SETUP.md: Moving out and vacant portions", () => {
  const moving = section(setup, "Moving out and vacant portions");

  it("replaces every 'Your Schedule is not changed': no document says it any more", () => {
    for (const [name, doc] of [["SETUP.md", setup], ["README.md", readme], ["THREAT-MODEL.md", threat]] as const) {
      expect(doc, name).not.toMatch(/Your Schedule is not changed/);
    }
  });

  it("says a move-out writes to the Tenants tab only, both with details on file and without", () => {
    expect(moving).toMatch(/never changes your Schedule/i);
    expect(moving).toMatch(/`Tenants` tab/);
    expect(moving).toMatch(/adds one row/i);
    expect(moving).toMatch(/without details|no details/i);
  });

  it("gives the vacancy rule: a move-out on the 1st leaves that month vacant, any later day leaves it due", () => {
    expect(moving).toMatch(/on or before the 1st/);
    expect(moving).toMatch(/Vacant/);
    expect(moving).toMatch(/1 vacant/);
    expect(moving).toMatch(/Add tenant/);
    expect(moving).toMatch(/New tenant/);
  });

  it("says Undo of a New tenant's first payment can reopen the tenancy it closed", () => {
    expect(moving).toMatch(/Undo/);
    expect(moving).toMatch(/reopen/i);
  });

  it("says a New tenant with the same name does not close the open details", () => {
    expect(moving).toMatch(/same name/);
  });

  it("states the known limit: a mistaken New tenant put right with Replace leaves the old tenancy closed, so the portion shows Vacant", () => {
    expect(moving).toMatch(/Replace/);
    expect(moving).toMatch(/Add tenant/);
    expect(moving).toMatch(/Add details/);
  });

  it("gives the owner's step before deploying: rows the older app closed for a same-name or undone New tenant still read as a move-out", () => {
    expect(moving).toMatch(/OWNER STEP|Before you deploy/);
    expect(moving).toMatch(/Move-out date/);
    expect(moving).toMatch(/by hand/);
  });
});

describe("the labels the docs tell a person to tap are in the source", () => {
  const labels: [string, string[]][] = [
    ["Add a portion", ["src/components/SettingsForm.tsx"]],
    ["Add portion", ["src/components/AddPortionSheet.tsx"]],
    ["Change order", ["src/components/SettingsForm.tsx", "src/components/PortionOrder.tsx"]],
    ["Save order", ["src/components/PortionOrder.tsx"]],
    ["Switch off", ["src/components/SettingsForm.tsx", "src/components/SwitchOffSheet.tsx"]],
    ["Switch on", ["src/components/SwitchedOffPortions.tsx"]],
    ["Switched off", ["src/components/SwitchedOffPortions.tsx"]],
    ["Prepare my Sheet", ["src/components/PrepareSheet.tsx"]],
    ["Check again", ["src/app/setup/page.tsx"]],
    ["Set up", ["src/app/more/page.tsx"]],
    ["Diagnostics", ["src/app/more/page.tsx"]],
    ["Portion settings", ["src/app/more/page.tsx"]],
    ["Add tenant", ["src/components/PortionBoard.tsx"]],
    ["Move out", ["src/app/tenants/[portionId]/page.tsx"]],
    ["Add details", ["src/components/PortionBoard.tsx"]],
    ["Past tenants", ["src/app/tenants/[portionId]/page.tsx"]],
  ];

  it.each(labels)("%s", (label, files) => {
    expect(files.some((file) => existsSync(`${ROOT}${file}`) && read(file).includes(label)), `${label} in ${files.join(", ")}`).toBe(true);
    expect(setup, `${label} in SETUP.md`).toContain(label);
  });
});

describe("README.md", () => {
  it("lists vacant portions, adding, switching off and reordering portions, and Set up and Diagnostics among the features", () => {
    const features = readme.slice(0, readme.indexOf("## Develop"));
    expect(features).toMatch(/Vacant/);
    expect(features).toMatch(/add, switch off and reorder portions|adding, switching off and reordering portions/i);
    expect(features).toContain("Set up");
    expect(features).toContain("Diagnostics");
  });

  it("no longer says the building has five portions", () => {
    expect(readme).not.toMatch(/with five portions/);
  });
});

describe("the threat model", () => {
  it("says /setup and /diagnostics are owner-only and show no secret, key, token or tenant data", () => {
    expect(threat).toContain("`/setup` and `/diagnostics` are owner-only and show no secret, key, token or tenant data.");
  });

  it("is right about it: both pages send a member away from the checks, and the Prepare route and the portion routes ask for the owner", () => {
    for (const page of ["src/app/setup/page.tsx", "src/app/diagnostics/page.tsx"]) {
      expect(read(page), page).toMatch(/!viewer\.isOwner/);
    }
    for (const route of [
      "src/app/api/setup/prepare/route.ts",
      "src/app/api/portions/route.ts",
      "src/app/api/portions/active/route.ts",
      "src/app/api/portions/order/route.ts",
    ]) {
      expect(read(route), route).toContain("requireOwner()");
    }
  });

  it("lists the routes that change something, the portion routes and Prepare my Sheet included, and no longer says the Payments Log header is overwritten", () => {
    const requests = threat.slice(threat.indexOf("### Requests to the API"));
    for (const route of ["/api/portions", "/api/portions/active", "/api/portions/order", "/api/setup/prepare"]) {
      expect(requests.slice(0, requests.indexOf("### Signed values")), route).toContain(`\`${route}\``);
    }
    expect(threat).not.toMatch(/it overwrites those two cells/);
  });

  it("says adding, switching off and reordering a portion take the write lock", () => {
    const consistent = threat.slice(threat.indexOf("### Keeping data consistent"));
    expect(consistent).toMatch(/adding, switching off or reordering a portion/i);
  });
});
