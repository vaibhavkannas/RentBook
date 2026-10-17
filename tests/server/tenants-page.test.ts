import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import { AppError, sheetStructure, validation } from "@/lib/errors";
import type { PortionTenants } from "@/lib/sheets/tenancy-service";
import { withoutComments } from "../support/source-scan";

// A smoke test of the tenant details page: it renders every state the page has, with the data layer
// replaced. The forms are client components; here they render their first (server) output only.

const nav = vi.hoisted(() => ({ search: "" }));

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getPortionTenants: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tenants/p1",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ readWrittenAt: async () => undefined }));
vi.mock("@/lib/sheets/tenancy-service", () => ({ getPortionTenants: mocks.getPortionTenants }));

import TenantsPage from "@/app/tenants/[portionId]/page";
import MoveOutForm from "@/components/MoveOutForm";
import TenancyForm from "@/components/TenancyForm";

const PORTION = {
  id: "p1",
  name: "Ground floor",
  tenantHeader: "Tenant",
  countHeader: "Count",
  amountHeader: "Amount",
  cycleLength: 11,
  hikePercent: 5,
};

function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
  return {
    rowNumber: 2,
    id: "t-1",
    portionId: "p1",
    tenant: "Asha",
    phone: "98765 43210",
    moveIn: "2026-01-15",
    agreementEnd: "2027-03-15",
    advance: 20000,
    advanceDate: "2026-01-10",
    advanceStatus: "Held",
    refund: null,
    deductions: null,
    notes: "Paid by cheque",
    moveOut: "",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

function data(overrides: Partial<PortionTenants> = {}): PortionTenants {
  return { portion: PORTION, scheduleTenant: "Asha", current: tenancy(), mismatched: null, past: [], vacantSince: null, ...overrides };
}

async function render(portionId = "p1", searchParams: Record<string, string | string[] | undefined> = {}): Promise<string> {
  const page = (await TenantsPage({
    params: Promise.resolve({ portionId }),
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

/** Every element in the tree the page returns, before anything is rendered: its props are what the page passes on. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [node as ReactElement<Record<string, unknown>>, ...elements(props.children as ReactNode)];
}

async function tree(searchParams: Record<string, string | string[] | undefined> = {}) {
  return elements(
    (await TenantsPage({ params: Promise.resolve({ portionId: "p1" }), searchParams: Promise.resolve(searchParams) })) as ReactElement,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = "";
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.getPortionTenants.mockResolvedValue(data());
});

describe("the tenant details page for a portion that is switched off", () => {
  const OFF_NOTICE = "This portion is switched off. Its history stays here.";

  it("says so in a notice, and shows everything else as for any portion", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ portion: { ...PORTION, inactive: true } }));
    const html = await render();
    expect(html).toContain(OFF_NOTICE);
    expect(html).toContain("Current tenancy");
    expect(html).toContain("Past tenants");
  });

  it("works for a portion with no current tenancy, a past tenant and Add details", async () => {
    mocks.getPortionTenants.mockResolvedValue(
      data({ portion: { ...PORTION, inactive: true }, current: null, past: [tenancy({ moveOut: "2026-09-30" })] }),
    );
    const html = await render();
    expect(html).toContain(OFF_NOTICE);
    expect(html).toContain("Add details");
    expect(html).toContain("Asha");
  });

  it("says nothing about it for a portion that is on", async () => {
    expect(await render()).not.toContain("switched off");
  });
});

describe("the tenant details page", () => {
  it("sends a person who is not signed in to the sign-in page", async () => {
    mocks.getViewer.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/signin");
    expect(mocks.getPortionTenants).not.toHaveBeenCalled();
  });

  it("asks the service for the portion in the address", async () => {
    await render("p1");
    expect(mocks.getPortionTenants).toHaveBeenCalledWith(expect.anything(), "p1", { minFetchedAt: undefined });
  });

  it("shows a 404 for a portion that does not exist", async () => {
    mocks.getPortionTenants.mockRejectedValue(validation("That portion isn't in your Settings any more. Tap another tab at the bottom of the screen and come back, then check the cards."));
    await expect(render("zz")).rejects.toThrow("not-found");
  });

  it("shows the current tenancy, an Edit button, a Move out section and an empty past list", async () => {
    const html = await render();
    expect(html).toContain("Ground floor");
    expect(html).toContain("Tenant in the Schedule: Asha");
    expect(html).toContain("Current tenancy");
    expect(html).toContain('href="tel:9876543210"');
    expect(html).toContain("15 Jan 2026");
    expect(html).toContain("15 Mar 2027");
    expect(html).toContain("₹ 20,000 · Held · paid 10 Jan 2026");
    // the notes sit on a row of their own, full width and left-aligned, not in the narrow right-aligned column
    expect(html).toMatch(/<dt class="text-muted">Notes<\/dt><dd class="[^"]*text-left[^"]*">Paid by cheque<\/dd>/);
    expect(html).not.toMatch(/Notes<\/dt><dd class="[^"]*text-right/);
    expect(html).toContain("owner@example.com");
    expect(html).toContain(">Edit<");
    expect(html).toContain('aria-label="Edit tenancy details"');
    expect(html).toContain("Move out");
    expect(html).toContain("No past tenants yet.");
    expect(html).not.toContain("Add details");
  });

  it("shows no changed-just-now notice on a normal visit", async () => {
    const html = await render();
    expect(html).not.toContain("This changed just now");
    expect(await render("p1", { changed: "0" })).not.toContain("This changed just now");
  });

  it("shows a changed-just-now notice at the top when the page was opened after a conflict", async () => {
    const html = await render("p1", { changed: "1" });
    expect(html).toContain("This changed just now. The page was updated. Please check and save again.");
    expect(html).toMatch(/role="alert" class="[^"]*bg-warn-bg[^"]*text-warn-ink[^"]*">This changed just now/);
    // above the tenant line and the cards
    expect(html.indexOf("This changed just now")).toBeLessThan(html.indexOf("Tenant in the Schedule"));
  });

  it("still shows the notice when there is no current tenancy", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ current: null }));
    expect(await render("p1", { changed: "1" })).toContain("This changed just now");
  });

  it("shows Not added for what is empty", async () => {
    mocks.getPortionTenants.mockResolvedValue(
      data({ current: tenancy({ phone: "", agreementEnd: "", advance: null, advanceStatus: null, notes: "" }) }),
    );
    const html = await render();
    expect(html.match(/Not added/g)).toHaveLength(4);
    expect(html).not.toContain("tel:");
  });

  it("shows the Add details form, and a Move out section that needs no details, when there is no current tenancy", async () => {
    // Deliberate change (3-10): this test said there was no Move out section here. A tenant the Schedule names, with no open
    // tenancy and no move-out yet, can now be recorded as moved out without adding their details first (see the next describe).
    mocks.getPortionTenants.mockResolvedValue(data({ current: null }));
    const html = await render();
    expect(html).toContain("Add details");
    expect(html).toContain('aria-label="Add tenancy details"');
    expect(html).toContain('id="move-out-heading"');
    expect(html).not.toContain(">Edit<");
  });

  it("says whose details are being added, and where a new tenant is added, under the Add details heading", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ current: null, scheduleTenant: "Hari" }));
    const html = await render();
    expect(html).toContain("Adding details for Hari. A new tenant is added with New tenant on the month screen.");
    expect(html.indexOf("Add details</h3>")).toBeLessThan(html.indexOf("Adding details for Hari"));
    expect(html.indexOf("Adding details for Hari")).toBeLessThan(html.indexOf("<form"));
  });

  it("has no Adding details hint when the Schedule names no tenant, and none while details exist", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ scheduleTenant: null, current: null }));
    expect(await render()).not.toContain("Adding details for");
    mocks.getPortionTenants.mockResolvedValue(data());
    expect(await render()).not.toContain("Adding details for");
  });

  it("hints under Move-in date that it can be changed, in the Add details form only", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ current: null }));
    expect(await render()).toContain("Change this if the tenant moved in earlier.");
    mocks.getPortionTenants.mockResolvedValue(data());
    expect(await render()).not.toContain("Change this if the tenant moved in earlier.");
  });

  it("says earlier details for another tenant will be closed, when the names differ", async () => {
    mocks.getPortionTenants.mockResolvedValue(
      data({ scheduleTenant: "Hari", current: null, mismatched: tenancy({ tenant: "Asha" }) }),
    );
    const html = await render();
    expect(html).toContain("Earlier details for Asha will be marked as moved out when you save.");
  });

  it("asks for a tenant first when the Schedule has none", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ scheduleTenant: null, current: null }));
    const html = await render();
    expect(html).toContain("No tenant recorded yet.");
    expect(html).toContain("Add a tenant from the month screen first.");
    expect(html).not.toContain('aria-label="Add tenancy details"');
  });

  it("lists past tenants with their dates and what happened to the advance", async () => {
    mocks.getPortionTenants.mockResolvedValue(
      data({
        current: null,
        past: [
          tenancy({
            rowNumber: 3,
            id: "t-2",
            tenant: "Bala",
            moveIn: "2025-02-01",
            moveOut: "2025-12-31",
            advanceStatus: "Adjusted",
            refund: 15000,
            deductions: 5000,
          }),
        ],
      }),
    );
    const html = await render();
    expect(html).toContain("Bala");
    expect(html).toContain("1 Feb 2025 to 31 Dec 2025");
    expect(html).toContain("Advance ₹ 20,000 · Adjusted · Refund ₹ 15,000 · Deductions ₹ 5,000");
    expect(html).not.toContain("No past tenants yet.");
  });

  it("shows a problem with the Tenants tab in plain words, with the portion's name, no forms, and that rent logging still works", async () => {
    mocks.getPortionTenants.mockResolvedValue(
      data({
        current: null,
        tenantsProblem:
          'The Tenants tab must have "Move-in date" in column E (found "Moved in"). Columns A to O must keep the 15 Tenants headers in their original order; extra columns may go to the right.',
      }),
    );
    const html = await render();
    expect(html).toContain("Ground floor");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Can&#x27;t show the tenant details");
    expect(html).toContain("Move-in date");
    expect(html).toContain("Moved in");
    expect(html).toContain("Logging rent and the other pages still work.");
    expect(html).toContain('href="/tenants/p1"');
    expect(html).not.toContain("Add details");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Past tenants");
  });

  it("explains a problem reading the Sheet, with a way to try again", async () => {
    mocks.getPortionTenants.mockRejectedValue(sheetStructure("The Tenants tab must have the headers."));
    const html = await render();
    expect(html).toContain("The Tenants tab must have the headers.");
    expect(html).toContain('href="/tenants/p1"');
    expect(html).toContain('role="alert"');
  });

  it("explains an unexpected failure without showing its details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPortionTenants.mockRejectedValue(new Error("socket hang up"));
    const html = await render();
    expect(html).toContain("Couldn&#x27;t reach Google Sheets. Try again.");
    expect(html).not.toContain("socket hang up");
    log.mockRestore();
  });

  it("treats another AppError code as a problem, not a 404", async () => {
    // (A connection problem, code "config", is shown to a member only as "ask the owner": see page-problems.test.ts.)
    mocks.getPortionTenants.mockRejectedValue(new AppError("sheet-structure", "Missing settings."));
    expect(await render()).toContain("Missing settings.");
  });
});

describe("the tenant details page: moving out and vacancy", () => {
  // A fixed today, after the move-out of the tests below (the nested describe moves it back for a move-out still to come).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T06:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const LEFT = tenancy({ id: "t-gone", rowNumber: 3, moveIn: "", moveOut: "2026-10-20", updatedBy: "owner@example.com" });

  it("says what a move-out does to the Schedule's month screen, in place of 'Your Schedule is not changed'", async () => {
    const html = await render();
    expect(html).toContain(
      "Record that Asha has moved out. Ground floor shows as Vacant from the first month that starts on or after the move-out date, until you add a new tenant. Payments already in your Schedule stay.",
    );
    expect(html).not.toContain("Your Schedule is not changed.");
  });

  it("gives the form of details on file its portion's name, for the toast", async () => {
    const found = await tree();
    expect(found.find((element) => element.type === MoveOutForm)?.props.portionName).toBe("Ground floor");
  });

  describe("a tenant the Schedule names, with no details on file and no move-out yet", () => {
    beforeEach(() => {
      mocks.getPortionTenants.mockResolvedValue(data({ current: null, scheduleTenant: "Asha" }));
    });

    it("shows a Move out section that says details are not needed first", async () => {
      const html = await render();
      expect(html).toContain('id="move-out-heading"');
      expect(html).toContain("Record that Asha has moved out. You don&#x27;t need to add their details first.");
      expect(html).toContain('aria-label="Move out Asha"');
      // the Add details form is still there, and above the Move out section
      expect(html).toContain('aria-label="Add tenancy details"');
      expect(html.indexOf('aria-label="Add tenancy details"')).toBeLessThan(html.indexOf('id="move-out-heading"'));
    });

    it("gives the form only the portion and the tenant: it closes no tenancy", async () => {
      const found = await tree({ month: "2026-10" });
      const form = found.find((element) => element.type === MoveOutForm);
      expect(form?.props.target).toEqual({ kind: "record", portionId: "p1", tenant: "Asha" });
      expect(form?.props.tenant).toBe("Asha");
      expect(form?.props.portionName).toBe("Ground floor");
      expect(form?.props.portionId).toBe("p1");
      expect(form?.props.monthKey).toBe("2026-10");
      expect(form?.props.initial).toEqual({
        moveOut: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        advanceStatus: "Held",
        refund: "",
        deductions: "",
        notes: "",
      });
    });

    it("has no Move out section when the Schedule names no tenant", async () => {
      mocks.getPortionTenants.mockResolvedValue(data({ current: null, scheduleTenant: null }));
      const html = await render();
      expect(html).not.toContain('id="move-out-heading"');
      expect(html).not.toContain("Record that");
    });

    it("has none when the portion has an open tenancy for another name, which Add details would close", async () => {
      mocks.getPortionTenants.mockResolvedValue(
        data({ current: null, scheduleTenant: "Hari", mismatched: tenancy({ tenant: "Asha" }) }),
      );
      expect(await render()).not.toContain('id="move-out-heading"');
    });

    it("has none once the tenant has moved out, and then says since when the portion is vacant, above Current tenancy", async () => {
      mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [LEFT], vacantSince: "2026-10-20" }));
      const html = await render();
      expect(html).not.toContain('id="move-out-heading"');
      expect(html).toContain("Vacant since 20 Oct 2026. Add the next tenant with New tenant on the month screen.");
      expect(html.indexOf("Vacant since 20 Oct 2026.")).toBeLessThan(html.indexOf('id="current-heading"'));
      expect(html.indexOf("Tenant in the Schedule: Asha")).toBeLessThan(html.indexOf("Vacant since"));
    });

    it("keeps the moved-out note and the Add details form for a tenant who has moved out", async () => {
      mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [LEFT], vacantSince: "2026-10-20" }));
      const html = await render();
      expect(html).toContain(
        "Asha moved out on 20 Oct 2026. Saving details here starts a new tenancy for Asha. The portion then stops showing as Vacant.",
      );
      expect(html).toContain('aria-label="Add tenancy details"');
    });

    it("does not say the portion is vacant in the note of a tenant who came back, when it is not", async () => {
      mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [LEFT], vacantSince: null }));
      const html = await render();
      expect(html).toContain("Asha moved out on 20 Oct 2026. Saving details here starts a new tenancy for Asha.");
      expect(html).not.toContain("stops showing as Vacant");
    });

    describe("a move-out dated after today", () => {
      beforeEach(() => {
        vi.setSystemTime(new Date("2026-10-17T06:00:00Z"));
      });

      it("says when the tenant moves out, not that the portion is vacant, and does not invite adding the next tenant", async () => {
        mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [{ ...LEFT, moveOut: "2026-12-20" }], vacantSince: "2026-12-20" }));
        const html = await render();
        expect(html).toContain("Moves out on 20 Dec 2026.");
        expect(html).not.toContain("Vacant since");
        expect(html).not.toContain("Add the next tenant");
      });

      it("says vacant since on the day itself, and the day after says when the tenant moves out", async () => {
        mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [LEFT], vacantSince: "2026-10-17" }));
        expect(await render()).toContain("Vacant since 17 Oct 2026. Add the next tenant with New tenant on the month screen.");
        mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [LEFT], vacantSince: "2026-10-18" }));
        const html = await render();
        expect(html).toContain("Moves out on 18 Oct 2026.");
        expect(html).not.toContain("Vacant since");
      });

      it("uses India's day: late on the 17th in UTC is already the 18th there", async () => {
        vi.setSystemTime(new Date("2026-10-17T20:00:00Z"));
        mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [LEFT], vacantSince: "2026-10-18" }));
        expect(await render()).toContain("Vacant since 18 Oct 2026.");
      });
    });

    it("lists a move-out recorded without details as a past tenant, with no move-in day", async () => {
      mocks.getPortionTenants.mockResolvedValue(data({ current: null, past: [LEFT], vacantSince: "2026-10-20" }));
      const html = await render();
      expect(html).toContain("— to 20 Oct 2026");
      expect(html).not.toContain("No past tenants yet.");
    });
  });

  it("says nothing about a vacancy while the portion is let", async () => {
    expect(await render()).not.toContain("Vacant since");
    mocks.getPortionTenants.mockResolvedValue(data({ current: null }));
    expect(await render()).not.toContain("Vacant since");
  });

  it("does not say it when the Tenants tab cannot be used", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ current: null, tenantsProblem: "Put the header back." }));
    const html = await render();
    expect(html).not.toContain("Vacant since");
    expect(html).not.toContain('id="move-out-heading"');
  });
});

describe("the tenant details page and the month it was opened from", () => {
  it("has an arrow back to the month screen that carries the month of the address", async () => {
    nav.search = "month=2026-10";
    const html = await render("p1", { month: "2026-10" });
    expect(html).toMatch(/<a [^>]*href="\/\?month=2026-10"[^>]*>‹<\/a>/);
    expect(html).toContain('aria-label="Back to month"');
  });

  it("has an arrow back to plain / when it was opened with no month", async () => {
    expect(await render()).toMatch(/<a [^>]*href="\/"[^>]*>‹<\/a>/);
  });

  it("gives both forms the month, so a save or a conflict keeps it in the address", async () => {
    const found = await tree({ month: "2026-10" });
    expect(found.find((element) => element.type === TenancyForm)?.props.monthKey).toBe("2026-10");
    expect(found.find((element) => element.type === MoveOutForm)?.props.monthKey).toBe("2026-10");
  });

  it("gives the Add details form the month too", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ current: null }));
    const found = await tree({ month: "2026-09" });
    expect(found.find((element) => element.type === TenancyForm)?.props.monthKey).toBe("2026-09");
  });

  it("passes no month when the address has none, or has one that is not a month", async () => {
    for (const searchParams of [{}, { month: "garbage" }, { month: ["nope", "2026-10"] }]) {
      const found = await tree(searchParams);
      expect(found.find((element) => element.type === TenancyForm)?.props.monthKey ?? null, JSON.stringify(searchParams)).toBeNull();
      expect(found.find((element) => element.type === MoveOutForm)?.props.monthKey ?? null).toBeNull();
    }
  });

  it("keeps the month in the Try again link when the Sheet cannot be read", async () => {
    mocks.getPortionTenants.mockRejectedValue(sheetStructure("The Tenants tab must have the headers."));
    expect(await render("p1", { month: "2026-10" })).toContain('href="/tenants/p1?month=2026-10"');
    expect(await render("p1")).toContain('href="/tenants/p1"');
  });

  it("keeps the month in the Try again link when the Tenants tab cannot be used", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ current: null, tenantsProblem: "Put the header back." }));
    expect(await render("p1", { month: "2026-10" })).toContain('href="/tenants/p1?month=2026-10"');
  });
});

describe("the tenant forms and the month", () => {
  const code = (name: string) =>
    withoutComments(readFileSync(new URL(`../../src/components/${name}.tsx`, import.meta.url), "utf8"));

  it.each(["TenancyForm", "MoveOutForm"])("%s takes the month and hands it to the page moves after a save and a conflict", (name) => {
    const source = code(name);
    expect(source).toMatch(/monthKey\??:\s*string \| null/);
    expect(source).toMatch(/pageAfterSave\([^)]*monthKey\)/);
    expect(source).toMatch(/pageAfterConflict\([^)]*monthKey\)/);
  });
});
