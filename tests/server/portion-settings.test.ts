import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionConfig } from "@/lib/domain/types";
import { buttonClasses, CARD, iconButtonClasses, noticeClasses, pillClasses } from "@/lib/ui-classes";
import { withoutComments, withoutCommentsAndStrings } from "../support/source-scan";
import { SWITCH_OFF_RULE } from "@/lib/portion-requests";
import { apiErrorMessage } from "@/lib/request-copy";
import { smallTargets, smallTextControls, unpressedTargets } from "../support/tap-targets";

// The Portion settings screen as the server renders it: the form for the portions that are on, each with Switch off; Add a
// portion and Change order under it; the Switched off section; and the four dialogs and editors. What a tap does, the
// focus and the pending states were checked in a browser (see the sitting 5 report); here: the words, the labels, the
// targets, and the source that sends the requests.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AddPortionSheet, { AddedPortion } from "@/components/AddPortionSheet";
import PortionOrder from "@/components/PortionOrder";
import SettingsForm from "@/components/SettingsForm";
import SwitchedOffPortions from "@/components/SwitchedOffPortions";
import SwitchOffSheet from "@/components/SwitchOffSheet";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const source = (name: string) => readFileSync(new URL(`../../src/components/${name}`, import.meta.url), "utf8");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text a person reads, without the markup. */
const visibleText = (out: string) =>
  out
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The opening tag of the button whose accessible name (its aria-label, else its text) is `name`. */
function button(out: string, name: string): string {
  for (const match of out.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)) {
    const label = /aria-label="([^"]*)"/.exec(match[1])?.[1];
    if ((label ?? visibleText(match[2])) === name) return match[1];
  }
  throw new Error(`no button named "${name}"`);
}

const port = (patch: Partial<PortionConfig> & { id: string; name: string }): PortionConfig => ({
  tenantHeader: "Tenant",
  countHeader: "Count",
  amountHeader: "Amount",
  cycleLength: 11,
  hikePercent: 5,
  ...patch,
});

const ground = port({ id: "p1", name: "Ground floor" });
const first = port({ id: "p2", name: "First floor", cycleLength: null, hikePercent: 7.5 });
const roof = port({ id: "p3", name: "Roof room", inactive: true });

const noop = () => {};

describe("SettingsForm", () => {
  const out = html(createElement(SettingsForm, { portions: [ground, first, roof] }));

  it("draws a card of fields only for the portions that are on", () => {
    expect(out.match(new RegExp(`<fieldset class="${CARD}`, "g"))).toHaveLength(2);
    expect(out).toContain('<legend class="sr-only">Settings for Ground floor</legend>');
    expect(out).toContain('<legend class="sr-only">Settings for First floor</legend>');
    expect(out).not.toContain("Settings for Roof room");
    expect(out).not.toContain('value="Roof room"');
  });

  it("gives each of them a Switch off button that names the portion", () => {
    for (const name of ["Ground floor", "First floor"]) {
      const tag = button(out, `Switch off ${name}`);
      expect(tag).toContain(`aria-label="Switch off ${name}"`);
      expect(tag).toContain(`class="${buttonClasses("dangerText", "md")}"`);
    }
    expect(out.match(/>Switch off<\/button>/g)).toHaveLength(2);
    expect(out).not.toContain("Switch off Roof room");
  });

  it("has Add a portion under the form, and Change order when there are two or more portions", () => {
    const add = button(out, "Add a portion");
    expect(add).toContain(`class="${buttonClasses("secondary", "md")} w-full"`);
    expect(button(out, "Change order")).toContain(`class="${buttonClasses("secondary", "md")} w-full"`);
    expect(out.indexOf("Save settings")).toBeLessThan(out.indexOf("Add a portion"));
    expect(out.indexOf("Add a portion")).toBeLessThan(out.indexOf("Change order"));
  });

  it("has no Change order for a single portion", () => {
    const one = html(createElement(SettingsForm, { portions: [ground] }));
    expect(one).toContain("Add a portion");
    expect(one).not.toContain("Change order");
  });

  it("counts a switched-off portion for Change order: it is in the order too", () => {
    const two = html(createElement(SettingsForm, { portions: [ground, roof] }));
    expect(two).toContain("Change order");
  });

  it("has a Switched off section with a card for each portion that is off, and none when none is", () => {
    expect(out).toMatch(/<h2[^>]*>Switched off<\/h2>/);
    expect(out).toContain("Roof room");
    expect(visibleText(out)).toContain("Hidden from the month screen. History kept.");
    expect(button(out, "Switch on Roof room")).toContain(`class="${buttonClasses("secondary", "md")} mt-3"`);
    const none = html(createElement(SettingsForm, { portions: [ground, first] }));
    expect(none).not.toContain("Switched off");
    expect(none).not.toContain("Switch on");
  });

  it("opens no dialog and no order editor until a button is pressed", () => {
    expect(out).not.toContain('role="dialog"');
    expect(out).not.toContain("<ol");
  });

  it("keeps the Save settings button the 48 px primary button, with its own words", () => {
    expect(out).toContain(`<button type="submit" class="${buttonClasses("primary", "lg")} w-full">Save settings</button>`);
  });

  it("has a target for a thumb in every button, and press feedback, and text a phone does not zoom in on", () => {
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
    expect(smallTextControls(out)).toEqual([]);
  });
});

describe("AddPortionSheet", () => {
  const out = html(createElement(AddPortionSheet, { onClose: noop }));

  it("is a dialog named Add a portion", () => {
    expect(out).toContain('role="dialog"');
    expect(out).toMatch(/aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(out)![1];
    expect(out).toContain(`<h2 id="${id}" class="text-lg font-semibold">Add a portion</h2>`);
  });

  it("has the three fields, with 11 payments per cycle and a 5 per cent hike to start from, and Count never resets", () => {
    for (const label of ["Portion name", "Payments per cycle", "Hike at each new cycle (%)"]) {
      expect(out).toContain(`<span class="text-muted">${label}</span>`);
    }
    const inputs = out.match(/<input [^>]*>/g) ?? [];
    expect(inputs.filter((tag) => !tag.includes('type="checkbox"'))).toHaveLength(3);
    expect(out).toMatch(/<input [^>]*value="11"/);
    expect(out).toMatch(/<input [^>]*value="5"/);
    expect(out).toMatch(/<input [^>]*value=""/);
    expect(out).toContain("Count never resets");
    expect(out.match(/type="checkbox"/g)).toHaveLength(1);
  });

  it("says what will be added to the Sheet, and that nothing else changes", () => {
    expect(visibleText(out)).toContain(
      "RentBook adds three columns for this portion (Tenant, Count and Amount) to the right of your Schedule, and a row to the Settings tab. Nothing else in your Sheet changes.",
    );
  });

  it("has a 48 px Add portion button, and a Close button", () => {
    expect(out).toContain(`<button type="submit" class="${buttonClasses("primary", "lg")} w-full">Add portion</button>`);
    expect(out).toContain(`aria-label="Close" class="${iconButtonClasses("muted")}"`);
  });

  it("leaves a wrong value to the server and to us (noValidate), and keeps the fields at 16 px with their own keyboards", () => {
    expect(out).toMatch(/<form\b[^>]*\snovalidate=""/i);
    expect(smallTextControls(out)).toEqual([]);
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
    expect(out).toMatch(/<input [^>]*inputMode="numeric"|<input [^>]*inputmode="numeric"/i);
    expect(out).toMatch(/<input [^>]*inputMode="decimal"|<input [^>]*inputmode="decimal"/i);
  });

  it("starts with no message and has an empty status region for Still working", () => {
    expect(out).not.toContain('role="alert"');
    expect(out).toContain('<div role="status" class="-mt-3"></div>');
  });
});

describe("AddedPortion: what the sheet says once the portion is added", () => {
  const result = {
    portion: port({ id: "p6", name: "Roof room" }),
    columns: [
      { header: "Tenant6", letter: "R" },
      { header: "Count6", letter: "S" },
      { header: "Amount6", letter: "T" },
    ],
    totalNote: null,
  };

  it("says it was added and where its columns are, in a success notice, and has a Done button", () => {
    const out = html(createElement(AddedPortion, { result, onDone: noop }));
    expect(out).toContain(noticeClasses("success"));
    expect(visibleText(out)).toContain("Roof room added. Its columns in your Schedule are Tenant6 (R), Count6 (S) and Amount6 (T).");
    expect(out).toContain(`class="${buttonClasses("primary", "lg")} w-full"`);
    expect(out).toMatch(/>Done<\/button>/);
    expect(out).not.toContain(noticeClasses("warn"));
    expect(smallTargets(out)).toEqual([]);
  });

  it("adds a warning with the note about the Total formula when there is one, and not otherwise", () => {
    const note = "Your Total column adds up the amounts with a formula. Add the Amount6 column (T) to it yourself.";
    const out = html(createElement(AddedPortion, { result: { ...result, totalNote: note }, onDone: noop }));
    expect(out).toContain(noticeClasses("warn"));
    expect(visibleText(out)).toContain(note);
  });
});

describe("SwitchOffSheet", () => {
  const out = html(createElement(SwitchOffSheet, { portion: { id: "p1", name: "Ground floor" }, onClose: noop, onSwitchedOff: noop }));

  it("is a dialog that asks Switch off Ground floor?", () => {
    expect(out).toContain('role="dialog"');
    const id = /aria-labelledby="([^"]+)"/.exec(out)![1];
    expect(out).toContain(`<h2 id="${id}" class="break-words text-lg font-semibold">Switch off Ground floor?</h2>`);
  });

  it("says when a portion can be switched off, in words that stay true if the rule gets stricter", () => {
    expect(SWITCH_OFF_RULE).toBe("A portion can be switched off only when it is vacant and nothing is owed.");
    expect(visibleText(out)).toContain(SWITCH_OFF_RULE);
  });

  it("says what happens to the portion's history, and that it can be switched back on", () => {
    expect(visibleText(out)).toContain(
      "It leaves the month screen and the New tenant list. Its payments stay in your Schedule and Payments Log, its tenants stay on its tenant page, and you can switch it back on here.",
    );
  });

  it("has a Switch off danger button and a Keep it on button", () => {
    expect(out).toContain(`class="${buttonClasses("danger", "lg")} w-full"`);
    expect(out).toMatch(/>Switch off<\/button>/);
    expect(out).toContain(`class="${buttonClasses("quiet", "md")} w-full"`);
    expect(out).toMatch(/>Keep it on<\/button>/);
  });

  it("keeps a place for a refusal that is announced when it comes, and shows none yet", () => {
    expect(out).toContain('<div role="status"></div>');
    expect(out).not.toContain('role="alert"');
  });

  it("has a target for a thumb in every button", () => {
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
  });
});

describe("PortionOrder", () => {
  const out = html(createElement(PortionOrder, { portions: [ground, first, roof], onCancel: noop, onSaved: noop }));
  const items = out.match(/<li\b[\s\S]*?<\/li>/g) ?? [];
  const item = (at: number) => items[at] ?? "";

  it("lists every portion, switched-off ones too, in an ordered list", () => {
    expect(out).toContain("<ol");
    expect(items).toHaveLength(3);
    expect(visibleText(item(0))).toContain("Ground floor");
    expect(visibleText(item(1))).toContain("First floor");
    expect(visibleText(item(2))).toContain("Roof room");
  });

  it("marks a portion that is off with an Off pill, and no other", () => {
    expect(out.match(new RegExp(`<span class="${escape(pillClasses("neutral"))}">Off</span>`, "g"))).toHaveLength(1);
    expect(item(2)).toContain(">Off<");
    expect(item(0)).not.toContain(">Off<");
  });

  it("gives each portion a Move up and a Move down button that name it, 44 px each, drawn as inline icons", () => {
    for (const name of ["Ground floor", "First floor", "Roof room"]) {
      for (const way of ["up", "down"]) {
        const tag = button(out, `Move ${name} ${way}`);
        expect(tag).toContain(`class="${iconButtonClasses("default")}"`);
      }
    }
    for (const item of items) expect(item.match(/<svg\b[^>]*aria-hidden="true"/g)).toHaveLength(2);
    expect(out).not.toMatch(/[▲▼↑↓]/);
  });

  it("disables Move up for the first portion and Move down for the last, and nothing else", () => {
    const disabled = (name: string) => /\sdisabled(?:=""|\s|>)/.test(name);
    expect(disabled(button(out, "Move Ground floor up"))).toBe(true);
    expect(disabled(button(out, "Move Ground floor down"))).toBe(false);
    expect(disabled(button(out, "Move First floor up"))).toBe(false);
    expect(disabled(button(out, "Move First floor down"))).toBe(false);
    expect(disabled(button(out, "Move Roof room up"))).toBe(false);
    expect(disabled(button(out, "Move Roof room down"))).toBe(true);
  });

  it("has a Save order button and a Cancel button, and a place for where a portion now is", () => {
    expect(out).toContain(`class="${buttonClasses("primary", "lg")} w-full"`);
    expect(out).toMatch(/>Save order<\/button>/);
    expect(out).toMatch(/>Cancel<\/button>/);
    expect(out).toContain('<div role="status"></div>');
  });

  it("has a target for a thumb in every button, and press feedback", () => {
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
  });
});

describe("SwitchedOffPortions", () => {
  const out = html(createElement(SwitchedOffPortions, { portions: [roof, port({ id: "p4", name: "Annex", inactive: true })], onSwitchedOn: noop }));

  it("is a section headed Switched off, with a card for each portion", () => {
    expect(out).toMatch(/<section[^>]*aria-labelledby="([^"]+)"/);
    expect(out).toMatch(/<h2 id="[^"]+" class="[^"]*">Switched off<\/h2>/);
    expect(out.match(new RegExp(`<div class="${CARD}`, "g"))).toHaveLength(2);
    expect(out).toContain("Roof room");
    expect(out).toContain("Annex");
  });

  it("says each is hidden and keeps its history, and offers Switch on", () => {
    expect(out.match(/Hidden from the month screen\. History kept\./g)).toHaveLength(2);
    expect(button(out, "Switch on Roof room")).toBeDefined();
    expect(button(out, "Switch on Annex")).toBeDefined();
    expect(out.match(/>Switch on<\/button>/g)).toHaveLength(2);
  });

  it("shows nothing for a list with nothing in it", () => {
    expect(html(createElement(SwitchedOffPortions, { portions: [], onSwitchedOn: noop }))).toBe("");
  });

  it("has a target for a thumb in every button", () => {
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
  });
});

describe("what the screen sends, and says after it", () => {
  const code = (name: string) => withoutComments(source(name));

  it("sends every request through sendJson, and never calls fetch itself", () => {
    for (const name of ["AddPortionSheet.tsx", "SwitchOffSheet.tsx", "PortionOrder.tsx", "SwitchedOffPortions.tsx"]) {
      expect(code(name), name).toMatch(/import \{[^}]*\bsendJson\b[^}]*\} from "@\/lib\/post-json"/);
      expect(withoutCommentsAndStrings(source(name)), name).toMatch(/(?<![.\w$])sendJson\s*(?:<[^>]*>)?\s*\(/);
      expect(withoutCommentsAndStrings(source(name)), name).not.toMatch(/(?<![.\w$])fetch\s*\(/);
    }
  });

  it("adds with a POST to /api/portions, switches off and on with a PUT to /api/portions/active, and saves the order with a PUT", () => {
    expect(code("AddPortionSheet.tsx")).toMatch(/sendJson<[^>]*>\(\s*"\/api\/portions"\s*,\s*request\.body\s*\)/);
    expect(code("SwitchOffSheet.tsx")).toMatch(/sendJson<[^>]*>\(\s*"\/api\/portions\/active"[^;]*\bactive: false\b[^;]*\bmethod: "PUT"/);
    expect(code("SwitchedOffPortions.tsx")).toMatch(/sendJson<[^>]*>\(\s*"\/api\/portions\/active"[^;]*\bactive: true\b[^;]*\bmethod: "PUT"/);
    expect(code("PortionOrder.tsx")).toMatch(/sendJson<[^>]*>\(\s*"\/api\/portions\/order"[^;]*\bids\b[^;]*\bmethod: "PUT"/);
  });

  it("builds the add request with the builder and shows its refusal before anything is sent", () => {
    const text = code("AddPortionSheet.tsx");
    const build = text.indexOf("buildAddPortionRequest(");
    const refuse = text.indexOf("if (!request.ok)");
    const send = text.indexOf('sendJson<AddPortionApiBody>("/api/portions"');
    expect(build).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(build);
    expect(send).toBeGreaterThan(refuse);
    expect(text).toMatch(/serverProblem\(/);
  });

  it("ends every write in a toast, with the words in toast-copy", () => {
    expect(code("AddPortionSheet.tsx")).toMatch(/toast\.show\(portionAddedToastText\(/);
    expect(code("SwitchOffSheet.tsx")).toMatch(/toast\.show\(portionSwitchedOffToastText\(/);
    expect(code("SwitchedOffPortions.tsx")).toMatch(/toast\.show\(portionSwitchedOnToastText\(/);
    expect(code("PortionOrder.tsx")).toMatch(/toast\.show\(ORDER_SAVED_TOAST\)/);
  });

  it("says what happened when no answer came, and takes the server's words for a refusal", () => {
    for (const name of ["AddPortionSheet.tsx", "SwitchOffSheet.tsx", "PortionOrder.tsx", "SwitchedOffPortions.tsx"]) {
      expect(code(name), name).toMatch(/sendFailureMessage\(sent, PORTION_NO_CONFIRMATION\)/);
      expect(code(name), name).toMatch(/\bsent\.kind\b/);
    }
    for (const name of ["SwitchOffSheet.tsx", "PortionOrder.tsx", "SwitchedOffPortions.tsx"]) {
      expect(code(name), name).toMatch(/apiErrorMessage\(/);
    }
  });

  it("disables what is being saved and gives the buttons their pending words", () => {
    expect(code("AddPortionSheet.tsx")).toMatch(/pendingLabel="Adding…"/);
    expect(code("SwitchOffSheet.tsx")).toMatch(/pendingLabel="Switching off…"/);
    expect(code("SwitchedOffPortions.tsx")).toMatch(/pendingLabel="Switching on…"/);
    expect(code("PortionOrder.tsx")).toMatch(/pendingLabel="Saving…"/);
    for (const name of ["AddPortionSheet.tsx", "SwitchOffSheet.tsx"]) expect(code(name), name).toMatch(/canClose=\{!busy\}/);
  });

  it("puts focus on Keep it on when the switch-off dialog opens", () => {
    const text = code("SwitchOffSheet.tsx");
    expect(text).toMatch(/initialFocus=\{keep\}/);
    expect(text).toMatch(/ref=\{keep\}/);
  });

  it("shows the server's own words for a refusal, whatever its code, and never a generic page-is-stale message in their place", () => {
    const tenant = "Ground floor still has a tenant (Asha). Record the move-out on the tenant page first.";
    for (const code of ["conflict", "validation", "sheet-structure"]) {
      expect(apiErrorMessage({ code, message: tenant }), code).toBe(tenant);
    }
    for (const name of ["SwitchOffSheet.tsx", "SwitchedOffPortions.tsx", "PortionOrder.tsx"]) {
      const text = code(name);
      expect(text, name).toMatch(/apiErrorMessage\(sent\.body\.error\)/);
      // a refusal changes nothing on the screen but the message: no list is taken from a body that is not ok
      expect(text, name).not.toMatch(/RELOAD_HINT|out of date/);
    }
  });

  it("builds every dialog on Sheet", () => {
    for (const name of ["AddPortionSheet.tsx", "SwitchOffSheet.tsx"]) {
      expect(code(name), name).toMatch(/import \{ Sheet \} from "@\/components\/ui\/Sheet"/);
    }
  });
});
