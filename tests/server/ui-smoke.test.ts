import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionCard } from "@/lib/domain/types";

// Smoke tests for the client components: their first render, as the server produces it. They check what a
// person (or a screen reader) finds on the page before anything is clicked. The logic is tested elsewhere.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
    // the status and alert regions are on the page from the start, empty, so their text is announced when it appears
    expect(out).toContain('<div role="status"></div>');
    expect(out).toContain('<div role="alert"></div>');
    expect(out).not.toContain('<p role="alert"');
    expect(out).not.toContain(">Cancel<");
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
    expect(out).toContain('<div role="alert"></div>');
    expect(out).not.toContain("<form");
  });
});

describe("MoveOutForm", () => {
  it("renders a Move out button that names the tenant, and no form until it is pressed", () => {
    const out = html(
      createElement(MoveOutForm, {
        tenant: "Asha",
        target: { id: "t-1", expectedUpdatedAt: "x", hasAdvance: true, initialNotes: "" },
        initial: emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "" }),
      }),
    );
    expect(out).toContain('aria-label="Move out Asha"');
    expect(out).toContain(">Move out<");
    expect(out).toContain('<div role="alert"></div>');
    expect(out).not.toContain("<form");
  });
});
