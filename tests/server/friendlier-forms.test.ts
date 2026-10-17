import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import { renderOpen as renderOpenWith } from "../support/render-open";
import { withoutComments } from "../support/source-scan";

// The forms: input hints for the phone's keyboard, forms that leave a wrong value to us (noValidate) and say what is
// wrong beside the field, and the settings words. What a tap does and where focus lands was checked in a browser.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("react", async (importOriginal) => (await import("../support/render-open")).mockReact(await importOriginal()));

import MoveOutForm from "@/components/MoveOutForm";
import PaymentSheet from "@/components/PaymentSheet";
import SettingsForm from "@/components/SettingsForm";
import TenancyForm from "@/components/TenancyForm";
import { SlowHint } from "@/components/ui/SlowHint";
import { emptyMoveOutForm, emptyTenancyForm } from "@/lib/tenancy-input";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const renderOpen = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderOpenWith(() => html(element));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The opening tag of the control inside the label with this text. */
function control(out: string, label: string): string {
  const found = new RegExp(`<label[^>]*><span[^>]*>${escape(label)}</span>(<(?:input|textarea|select)\\b[^>]*>)`).exec(out);
  expect(found, `a control labelled "${label}"`).not.toBeNull();
  return found![1];
}

/** Whether the tag has the attribute with the value; HTML names are not case-sensitive, so neither is this. */
const has = (tag: string, name: string, value?: string) =>
  new RegExp(`\\s${name}${value === undefined ? "(?:=|\\s|/|>)" : `="${escape(value)}"`}`, "i").test(tag);

const card = (overrides: Partial<PortionCard> = {}): PortionCard => ({
  portionId: "p1",
  name: "Ground floor",
  cycleLength: 11,
  status: "pending",
  entry: null,
  next: { tenant: "Asha", count: 4, suggestedAmount: 10000, previousAmount: 10000, startsNewCycle: false },
  rentReference: 10000,
  rentDifference: null,
  undoBlockedReason: null,
  tenancy: null,
  ...overrides,
});

const sheet = (mode: "log" | "edit" | "new-tenant") =>
  html(
    createElement(PaymentSheet, {
      mode,
      monthKey: "2026-10",
      monthLabel: "October 2026",
      cards: [card({ status: mode === "edit" ? "paid" : "pending", entry: mode === "edit" ? { tenant: "Asha", count: 4, amount: 10000 } : null })],
      initialPortionId: mode === "new-tenant" ? null : "p1",
      defaultDate: "2026-10-05",
      onClose: () => {},
    }),
  );

const tenancyForm = (mode: "create" | "edit") =>
  (mode === "edit" ? renderOpen : html)(
    createElement(TenancyForm, {
      target:
        mode === "create"
          ? { mode: "create", portionId: "p1", tenant: "Asha" }
          : { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "x" },
      initial: emptyTenancyForm("2026-10-05"),
    }),
  );

const moveOutForm = () =>
  renderOpen(
    createElement(MoveOutForm, {
      tenant: "Asha",
      portionId: "p1",
      target: { id: "t-1", expectedUpdatedAt: "x", hasAdvance: true, initialNotes: "" },
      initial: emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "" }),
    }),
  );

const HEADERS = { tenantHeader: "Tenant", countHeader: "Count", amountHeader: "Amount" };
const settingsForm = () =>
  html(
    createElement(SettingsForm, {
      portions: [
        { ...HEADERS, id: "p1", name: "Ground floor", cycleLength: 11, hikePercent: 5 },
        { ...HEADERS, id: "p2", name: "Attic", cycleLength: null, hikePercent: 0 },
      ],
    }),
  );

describe("the hints a phone's keyboard takes", () => {
  it("the amount: numbers, a Done key, and no suggestions from the browser", () => {
    for (const mode of ["log", "edit", "new-tenant"] as const) {
      const tag = control(sheet(mode), "Amount received (₹)");
      expect(has(tag, "inputMode", "numeric"), mode).toBe(true);
      expect(has(tag, "enterKeyHint", "done"), mode).toBe(true);
      expect(has(tag, "autoComplete", "off"), mode).toBe(true);
    }
  });

  it("a new tenant's name: words capitalised, no spell check, no saved suggestions, a Next key", () => {
    const tag = control(sheet("new-tenant"), "Tenant name");
    expect(has(tag, "autoComplete", "off")).toBe(true);
    expect(has(tag, "autoCapitalize", "words")).toBe(true);
    expect(has(tag, "spellCheck", "false")).toBe(true);
    expect(has(tag, "enterKeyHint", "next")).toBe(true);
  });

  it("a phone number: the phone keypad, and not the user's own number: no autofill", () => {
    for (const out of [sheet("new-tenant"), tenancyForm("create"), tenancyForm("edit")]) {
      const tag = control(out, "Phone");
      expect(has(tag, "type", "tel")).toBe(true);
      expect(has(tag, "autoComplete", "off")).toBe(true);
    }
  });

  it("every amount in rupees: numbers, and no saved suggestions", () => {
    const fields: Array<[string, string]> = [
      [sheet("new-tenant"), "Advance (₹)"],
      [tenancyForm("create"), "Advance (₹)"],
      [moveOutForm(), "Refund (₹)"],
      [moveOutForm(), "Deductions (₹)"],
    ];
    for (const [out, label] of fields) {
      const tag = control(out, label);
      expect(has(tag, "inputMode", "numeric"), label).toBe(true);
      expect(has(tag, "autoComplete", "off"), label).toBe(true);
    }
  });

  it("the settings: payments per cycle takes numbers, the hike takes decimals, neither is suggested from earlier forms, a portion's name capitalises words", () => {
    const out = settingsForm();
    expect(has(control(out, "Payments per cycle"), "inputMode", "numeric")).toBe(true);
    expect(has(control(out, "Hike at each new cycle (%)"), "inputMode", "decimal")).toBe(true);
    // a number of the owner's own, not a thing for the browser to suggest from earlier forms
    expect(has(control(out, "Payments per cycle"), "autoComplete", "off")).toBe(true);
    expect(has(control(out, "Hike at each new cycle (%)"), "autoComplete", "off")).toBe(true);
    const name = control(out, "Portion name");
    expect(has(name, "autoCapitalize", "words")).toBe(true);
    expect(has(name, "autoComplete", "off")).toBe(true);
  });

  it("notes start a sentence with a capital", () => {
    expect(has(control(tenancyForm("create"), "Notes"), "autoCapitalize", "sentences")).toBe(true);
    expect(has(control(moveOutForm(), "Notes"), "autoCapitalize", "sentences")).toBe(true);
  });

  it("dates stay date fields, so the phone shows its own date picker", () => {
    for (const [out, label] of [
      [sheet("log"), "Date received"],
      [sheet("new-tenant"), "Move-in date"],
      [sheet("new-tenant"), "Advance date"],
      [sheet("new-tenant"), "Agreement end"],
      [tenancyForm("create"), "Move-in date"],
      [moveOutForm(), "Move-out date"],
    ] as const) {
      expect(has(control(out, label), "type", "date"), label).toBe(true);
    }
  });
});

describe("forms that leave a wrong value to us", () => {
  it.each([
    ["the payment sheet", () => sheet("log")],
    ["the New tenant sheet", () => sheet("new-tenant")],
    ["the tenancy form, adding", () => tenancyForm("create")],
    ["the tenancy form, editing", () => tenancyForm("edit")],
    ["the move-out form", () => moveOutForm()],
    ["the settings form", () => settingsForm()],
  ])("%s has no browser validation bubbles", (_name, render) => {
    expect(render()).toMatch(/<form\b[^>]*\snovalidate=""/i);
  });

  it("the fields that must be filled in still say so, for a screen reader (required)", () => {
    expect(has(control(sheet("log"), "Amount received (₹)"), "required")).toBe(true);
    expect(has(control(sheet("log"), "Date received"), "required")).toBe(true);
    expect(has(control(sheet("new-tenant"), "Tenant name"), "required")).toBe(true);
    expect(has(control(sheet("new-tenant"), "Portion"), "required")).toBe(true);
    expect(has(control(tenancyForm("create"), "Move-in date"), "required")).toBe(true);
    expect(has(control(moveOutForm(), "Move-out date"), "required")).toBe(true);
    expect(has(control(settingsForm(), "Portion name"), "required")).toBe(true);
  });

  it("show no message before anything is wrong: no field is invalid, and nothing is announced", () => {
    for (const out of [sheet("new-tenant"), tenancyForm("create"), moveOutForm(), settingsForm()]) {
      expect(out).not.toContain("aria-invalid");
      expect(out).not.toContain('role="alert"');
    }
  });
});

describe("the settings words", () => {
  const out = settingsForm();

  it("calls the three fields Portion name, Payments per cycle and Hike at each new cycle (%)", () => {
    for (const label of ["Portion name", "Payments per cycle", "Hike at each new cycle (%)"]) {
      control(out, label);
    }
    for (const old of [">Name<", ">Cycle length<", ">Hike %<"]) expect(out).not.toContain(old);
  });

  it("explains payments per cycle under the field, and ties the explanation to the field", () => {
    const hint = "After this many payments the count starts again at 1 and the hike is added.";
    const id = new RegExp(`<p id="([^"]+)"[^>]*>${escape(hint)}</p>`).exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(control(out, "Payments per cycle")).toContain(`aria-describedby="${id}"`);
    // once for each portion
    expect(out.match(new RegExp(escape(hint), "g"))).toHaveLength(2);
  });

  it("keeps Count never resets", () => {
    expect(out).toContain("Count never resets");
  });
});

describe("the payment sheet's button", () => {
  it("says Save to Sheet, the Sheet being the owner's own Google Sheet", () => {
    for (const mode of ["log", "edit", "new-tenant"] as const) {
      expect(sheet(mode)).toContain(">Save to Sheet<");
      expect(sheet(mode)).not.toContain("Save to sheet");
    }
  });
});

describe("the hint for a slow save", () => {
  it("is a status region that is on the page from the start, empty, so its words are announced when they arrive", () => {
    for (const busy of [false, true]) {
      expect(html(createElement(SlowHint, { busy }))).toBe('<div role="status" class="-mt-3"></div>');
    }
  });

  it("is a LiveNotice that pulls itself up by the column's spacing while it is empty, so the button above it keeps the room it had", () => {
    const code = withoutComments(readFileSync(new URL("../../src/components/ui/SlowHint.tsx", import.meta.url), "utf8"));
    expect(code).toMatch(/<LiveNotice tone="warn" emptyClassName="-mt-3">/);
  });

  it.each(["MoveOutForm", "PaymentSheet", "SettingsForm", "TenancyForm", "UndoSheet"])("%s shows it under its button while it saves", (name) => {
    const code = withoutComments(readFileSync(new URL(`../../src/components/${name}.tsx`, import.meta.url), "utf8"));
    expect(code).toMatch(/import \{ SlowHint \} from "@\/components\/ui\/SlowHint"/);
    expect(code).toMatch(/<SlowHint busy=\{busy\} \/>/);
  });
});

describe("how the five components send", () => {
  const code = (name: string) => withoutComments(readFileSync(new URL(`../../src/components/${name}.tsx`, import.meta.url), "utf8"));

  it.each(["MoveOutForm", "PaymentSheet", "SettingsForm", "TenancyForm", "UndoSheet"])("%s sends with sendJson and says why no answer came", (name) => {
    expect(code(name)).toMatch(/import \{[^}]*\bsendJson\b[^}]*\} from "@\/lib\/post-json"/);
    expect(code(name)).toMatch(/\bsendJson</);
    expect(code(name)).toMatch(/\bsendFailureMessage\(/);
    expect(code(name)).not.toMatch(/\bpostJson\b/);
  });

  it.each(["MoveOutForm", "PaymentSheet", "SettingsForm", "TenancyForm"])("%s moves focus to the first field with a problem", (name) => {
    expect(code(name)).toMatch(/import \{ useFieldFocus \} from "\.\/useFieldFocus"/);
    expect(code(name)).toMatch(/\buseFieldFocus\(/);
  });

  it.each(["MoveOutForm", "PaymentSheet", "SettingsForm", "TenancyForm"])("%s clears a field's problem when something is typed in it", (name) => {
    expect(code(name)).toMatch(/\bafterEdit\(/);
  });

  it("the New tenant sheet opens its details box when the problem is inside it", () => {
    expect(code("PaymentSheet")).toMatch(/isDetailField\(/);
    expect(code("PaymentSheet")).toMatch(/setDetailsOpen\(true\)/);
  });
});
