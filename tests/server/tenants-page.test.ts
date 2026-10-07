import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenancy } from "@/lib/domain/tenancy";
import { AppError, sheetStructure, validation } from "@/lib/errors";
import type { PortionTenants } from "@/lib/sheets/tenancy-service";

// A smoke test of the tenant details page: it renders every state the page has, with the data layer
// replaced. The forms are client components; here they render their first (server) output only.

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
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ readWrittenAt: async () => undefined }));
vi.mock("@/lib/sheets/tenancy-service", () => ({ getPortionTenants: mocks.getPortionTenants }));

import TenantsPage from "@/app/tenants/[portionId]/page";

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
  return { portion: PORTION, scheduleTenant: "Asha", current: tenancy(), mismatched: null, past: [], ...overrides };
}

async function render(portionId = "p1"): Promise<string> {
  const page = (await TenantsPage({ params: Promise.resolve({ portionId }) })) as ReactElement;
  return renderToStaticMarkup(createElement(() => page));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
  mocks.getPortionTenants.mockResolvedValue(data());
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
    mocks.getPortionTenants.mockRejectedValue(validation('Unknown portion "zz".'));
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
    expect(html).toContain("₹ 20,000 · Held · paid 10 Jan 2026");
    expect(html).toContain("Paid by cheque");
    expect(html).toContain("owner@example.com");
    expect(html).toContain(">Edit<");
    expect(html).toContain('aria-label="Edit tenancy details"');
    expect(html).toContain("Move out");
    expect(html).toContain("No past tenants yet.");
    expect(html).not.toContain("Add details");
  });

  it("shows Not added for what is empty", async () => {
    mocks.getPortionTenants.mockResolvedValue(
      data({ current: tenancy({ phone: "", agreementEnd: "", advance: null, advanceStatus: null, notes: "" }) }),
    );
    const html = await render();
    expect(html.match(/Not added/g)).toHaveLength(4);
    expect(html).not.toContain("tel:");
  });

  it("shows the Add details form, without a Move out section, when there is no current tenancy", async () => {
    mocks.getPortionTenants.mockResolvedValue(data({ current: null }));
    const html = await render();
    expect(html).toContain("Add details");
    expect(html).toContain('aria-label="Add tenancy details"');
    expect(html).not.toContain('id="move-out-heading"');
    expect(html).not.toContain(">Edit<");
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
    expect(html).toContain("Advance ₹ 20,000 · Adjusted · Refund ₹ 15,000 · Deductions ₹ 5,000");
    expect(html).not.toContain("No past tenants yet.");
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
    mocks.getPortionTenants.mockRejectedValue(new AppError("config", "Missing settings."));
    expect(await render()).toContain("Missing settings.");
  });
});
