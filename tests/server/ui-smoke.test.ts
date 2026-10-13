import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionCard } from "@/lib/domain/types";

// Smoke tests for the client components: their first render, as the server produces it. They check what a
// person (or a screen reader) finds on the page before anything is clicked. The logic is tested elsewhere.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import TenantsLoading from "@/app/tenants/[portionId]/loading";
import MoveOutForm from "@/components/MoveOutForm";
import PaymentSheet from "@/components/PaymentSheet";
import PortionBoard from "@/components/PortionBoard";
import TenancyForm from "@/components/TenancyForm";
import { emptyMoveOutForm, emptyTenancyForm } from "@/lib/tenancy-input";

function card(overrides: Partial<PortionCard> = {}): PortionCard {
  return {
    portionId: "p1",
    name: "Ground floor",
    cycleLength: 11,
    status: "pending",
    entry: null,
    next: { tenant: "Asha", count: 4, suggestedAmount: 10000, previousAmount: 10000, startsNewCycle: false },
    undoBlockedReason: null,
    tenancy: null,
    ...overrides,
  };
}

const SUMMARY = {
  id: "t-1",
  phone: "98765 43210",
  moveIn: "2026-01-15",
  agreementEnd: "2027-03-15",
  advance: 20000,
  advanceStatus: "Held" as const,
  updatedAt: "2026-01-15T05:00:00.000Z",
};

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

function board(cards: PortionCard[]) {
  return html(
    createElement(PortionBoard, { monthKey: "2026-10", monthLabel: "October 2026", cards, defaultDate: "2026-10-05" }),
  );
}

describe("PortionBoard", () => {
  it("shows the chips and a Details link on a card whose tenant has details", () => {
    const out = board([card({ tenancy: SUMMARY })]);
    expect(out).toContain("Advance ₹ 20,000 held");
    expect(out).toContain("Agreement ends 15 Mar 2027");
    expect(out).toContain('href="/tenants/p1"');
    expect(out).toContain('aria-label="Details for Ground floor"');
    expect(out).not.toContain("Add details");
  });

  it("shows only an Add details link when the tenant has no details", () => {
    const out = board([card({ tenancy: null })]);
    expect(out).toContain('aria-label="Add details for Ground floor"');
    expect(out).toContain('href="/tenants/p1"');
    expect(out).not.toContain("Advance");
    expect(out).not.toContain("Agreement ends");
  });

  it("shows a Details link and no chips for details that have nothing to show on the card", () => {
    const out = board([card({ tenancy: { ...SUMMARY, advance: null, advanceStatus: null, agreementEnd: "" } })]);
    expect(out).toContain('aria-label="Details for Ground floor"');
    expect(out).not.toContain("Advance");
  });

  it("works for a paid card too", () => {
    const paid = card({
      status: "paid",
      entry: { tenant: "Asha", count: 3, amount: 10000 },
      next: null,
      tenancy: SUMMARY,
    });
    expect(board([paid])).toContain('href="/tenants/p1"');
  });

  it("shows neither chips nor a link on a card with no tenant", () => {
    const out = board([card({ status: "needs-tenant", next: null })]);
    expect(out).toContain("No tenant recorded yet.");
    expect(out).not.toContain("/tenants/");
    expect(out).not.toContain("details");
  });

  it("keeps the amount line's spacing below the details row", () => {
    expect(board([card()])).toContain('<p class="mt-2 text-lg font-medium">');
  });

  it("gives the link a tap target of at least 44 px", () => {
    expect(board([card()])).toMatch(/<a [^>]*class="[^"]*min-h-11[^"]*"/);
  });
});

describe("PaymentSheet", () => {
  const props = {
    monthKey: "2026-10",
    monthLabel: "October 2026",
    cards: [card({ status: "needs-tenant", next: null })],
    initialPortionId: "p1",
    defaultDate: "2026-10-05",
    onClose: () => {},
  };

  it("has a collapsed Tenancy details section in the New tenant sheet, with the move-in date set to the default", () => {
    const out = html(createElement(PaymentSheet, { ...props, mode: "new-tenant" }));
    expect(out).toContain("Tenancy details (optional)");
    expect(out).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/);
    for (const label of ["Move-in date", "Advance (₹)", "Advance date", "Agreement end", "Phone"]) {
      expect(out).toContain(label);
    }
    // the move-in date field starts on today; the Date received field does too
    expect(out.match(/value="2026-10-05"/g)).toHaveLength(2);
  });

  it("draws the section as a box with a visible border and a chevron that turns when it is open", () => {
    const out = html(createElement(PaymentSheet, { ...props, mode: "new-tenant" }));
    // a native disclosure: details and summary, still at least 44px tall
    expect(out).toMatch(/<details[^>]*class="[^"]*\bgroup\b[^"]*border-control[^"]*"/);
    expect(out).not.toMatch(/<details[^>]*border-line/);
    const summary = out.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(summary).toContain("min-h-11");
    expect(summary).toContain("Tenancy details (optional)");
    // the chevron is drawn, hidden from screen readers, and rotates with the details element
    expect(summary).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(summary).toContain("group-open:rotate-90");
  });

  it("has its status region on the page from the start, empty, for the tenancy warning", () => {
    const out = html(createElement(PaymentSheet, { ...props, mode: "new-tenant" }));
    expect(out).toContain('<div role="status"></div>');
    expect(out).not.toContain("weren&#x27;t saved");
  });

  it("does not offer the section when logging or editing a payment", () => {
    for (const mode of ["log", "edit"] as const) {
      const out = html(
        createElement(PaymentSheet, { ...props, mode, cards: [card({ status: "pending" })] }),
      );
      expect(out).not.toContain("Tenancy details");
    }
  });
});

describe("TenancyForm", () => {
  it("renders the Add details form open, with every field labelled and a Save button", () => {
    const out = html(
      createElement(TenancyForm, {
        target: { mode: "create", portionId: "p1", tenant: "Asha" },
        initial: emptyTenancyForm("2026-10-05"),
      }),
    );
    for (const label of ["Phone", "Move-in date", "Agreement end", "Advance (₹)", "Advance date", "Notes"]) {
      expect(out).toMatch(new RegExp(`<label[^>]*>\\s*<span[^>]*>${label.replace(/[()]/g, "\\$&")}</span>\\s*<(input|textarea)`));
    }
    expect(out).toContain('value="2026-10-05"');
    expect(out).toContain("Save details");
    expect(out).toContain('maxLength="500"');
    // the status region is on the page from the start, empty, so its text is announced when it appears
    expect(out).toContain('<div role="status"></div>');
    expect(out).not.toContain('<p role="alert"');
    // a conflict is shown by the page itself, not by the form
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain(">Cancel<");
  });

  it("hints under the move-in date of the Add details form that it can be changed, and links the hint to the field", () => {
    const out = html(
      createElement(TenancyForm, {
        target: { mode: "create", portionId: "p1", tenant: "Asha" },
        initial: emptyTenancyForm("2026-10-05"),
      }),
    );
    expect(out).toContain("Change this if the tenant moved in earlier.");
    const hintId = out.match(/<p id="([^"]+)"[^>]*>Change this if the tenant moved in earlier\./)?.[1];
    expect(hintId).toBeTruthy();
    expect(out).toContain(`aria-describedby="${hintId}"`);
  });

  it("renders the edit form closed, behind an Edit button", () => {
    const out = html(
      createElement(TenancyForm, {
        target: { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "x" },
        initial: emptyTenancyForm("2026-01-15"),
      }),
    );
    expect(out).toContain(">Edit<");
    expect(out).toContain('<div role="status"></div>');
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("<form");
  });
});

describe("MoveOutForm", () => {
  it("renders a Move out button that names the tenant, and no form until it is pressed", () => {
    const out = html(
      createElement(MoveOutForm, {
        tenant: "Asha",
        portionId: "p1",
        target: { id: "t-1", expectedUpdatedAt: "x", hasAdvance: true, initialNotes: "" },
        initial: emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "" }),
      }),
    );
    expect(out).toContain('aria-label="Move out Asha"');
    expect(out).toContain(">Move out<");
    // a conflict is shown by the page itself, not by the form
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("<form");
  });
});

describe("the tenant details loading screen", () => {
  const out = html(createElement(TenantsLoading));

  it("has a working back link and says what is loading", () => {
    expect(out).toContain('href="/"');
    expect(out).toContain('aria-label="Back to month"');
    expect(out).toContain("Loading tenant details");
    expect(out).toContain('aria-busy="true"');
  });

  it("shows a title bar and two cards, with the existing colour tokens", () => {
    expect(out.match(/rounded-2xl border border-line bg-surface/g)).toHaveLength(2);
    expect(out).toContain("bg-line");
  });

  it("pulses only for people who have not asked for less motion", () => {
    expect(out).toContain("animate-pulse");
    expect(out).toContain("motion-reduce:animate-none");
    // every animated bar has the fallback
    expect(out.match(/animate-pulse/g)!.length).toBe(out.match(/motion-reduce:animate-none/g)!.length);
  });
});
