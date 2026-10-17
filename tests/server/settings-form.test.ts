import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionConfig } from "@/lib/domain/types";
import { buttonClasses, CARD } from "@/lib/ui-classes";

// The settings form as the server renders it: one card of three fields and a checkbox for each portion, and a Save
// button. The saving itself (postJson, the message) is exercised in the other client tests and by hand.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import SettingsForm from "@/components/SettingsForm";

const portions: PortionConfig[] = [
  { id: "p1", name: "Ground floor", tenantHeader: "Tenant", countHeader: "Count", amountHeader: "Amount", cycleLength: 11, hikePercent: 5 },
  { id: "p2", name: "First floor", tenantHeader: "Tenant", countHeader: "Count", amountHeader: "Amount", cycleLength: null, hikePercent: 7.5 },
];

const html = renderToStaticMarkup(createElement(SettingsForm, { portions }));

describe("SettingsForm", () => {
  it("draws each portion as a card (a fieldset with a hidden legend) holding Portion name, Payments per cycle, Hike at each new cycle (%) and a checkbox", () => {
    expect(html.match(new RegExp(`<fieldset class="${CARD}`, "g"))).toHaveLength(2);
    expect(html).toContain('<legend class="sr-only">Settings for Ground floor</legend>');
    for (const label of ["Portion name", "Payments per cycle", "Hike at each new cycle (%)"]) {
      expect(html.match(new RegExp(`<span class="text-muted">${label.replace(/[()]/g, "\\$&")}</span>`, "g"))).toHaveLength(2);
    }
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/Count never resets/g)).toHaveLength(2);
  });

  it("labels every field with its own id, so a screen reader reads the name with the box", () => {
    const ids = [...html.matchAll(/<input [^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html).toContain(`<label for="${id}"`);
  });

  it("starts the fields from the stored values, and disables the cycle length of a portion that never resets", () => {
    expect(html).toContain('value="Ground floor"');
    expect(html).toContain('value="11"');
    expect(html).toContain('value="7.5"');
    expect(html.match(/<input [^>]*\bdisabled=""/g)).toHaveLength(1);
    expect(html).toContain('checked=""');
  });

  it("keeps the amounts and the text at 16 px, so a phone does not zoom in", () => {
    const fields = (html.match(/<input [^>]*>/g) ?? []).filter((control) => !control.includes('type="checkbox"'));
    expect(fields).toHaveLength(6);
    for (const control of fields) expect(control).toMatch(/class="[^"]*\btext-base\b/);
  });

  it("ends in a 48 px Save settings button, and shows no message before anything is saved", () => {
    expect(html).toContain(`<button type="submit" class="${buttonClasses("primary", "lg")} w-full">Save settings</button>`);
    expect(html).not.toContain('role="alert"');
    // the only status region is the empty one for "Still working", under the button
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('<div role="status" class="-mt-3"></div>');
  });
});
