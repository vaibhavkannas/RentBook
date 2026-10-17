import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { moveOutBody, paymentBody, settingsBody, tenancyBody } from "@/lib/server/schemas";

/** The first problem a schema finds with `value`, as "path: message", or null when it is fine. */
function problem(schema: ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  if (result.success) return null;
  const issue = result.error.issues[0];
  return `${issue.path.join(".")}: ${issue.message}`;
}

const payment = { month: "2026-10", portionId: "p1", amount: 5450, dateReceived: "2026-10-05" };
const tenancy = { portionId: "p1", tenant: "Asha", fields: { moveIn: "2026-10-01" } };
const moveOut = { id: "t-1", expectedUpdatedAt: "2026-10-01T00:00:00.000Z", moveOut: "2026-12-31" };
const settings = { portions: [{ id: "p1", name: "Ground floor", cycleLength: 11, hikePercent: 5 }] };

describe("paymentBody", () => {
  it("takes a date received from 2000 to 2100", () => {
    expect(problem(paymentBody, payment)).toBeNull();
    expect(problem(paymentBody, { ...payment, dateReceived: "2000-01-01" })).toBeNull();
    expect(problem(paymentBody, { ...payment, dateReceived: "2100-12-31" })).toBeNull();
  });

  it("refuses a date received outside 2000 to 2100, or not a real day", () => {
    expect(problem(paymentBody, { ...payment, dateReceived: "1999-12-31" })).toBe(
      "dateReceived: Date received must be a date from 2000 to 2100.",
    );
    expect(problem(paymentBody, { ...payment, dateReceived: "2101-01-01" })).toBe(
      "dateReceived: Date received must be a date from 2000 to 2100.",
    );
    expect(problem(paymentBody, { ...payment, dateReceived: "2026-02-30" })).toBe(
      "dateReceived: Date received isn't a real date.",
    );
  });

  it("says in plain words that a month is not a month, and what to do", () => {
    for (const month of ["Oct", "2026-13", "2026-1", "2026-10-05", ""]) {
      expect(problem(paymentBody, { ...payment, month }), month).toBe(
        "month: That month isn't valid. Open it again from the month screen.",
      );
    }
    expect(problem(paymentBody, { ...payment, month: "2026-12" })).toBeNull();
  });

  it("treats a date received that is far too long as not a real date, in the same words", () => {
    expect(problem(paymentBody, { ...payment, dateReceived: "x".repeat(201) })).toBe(
      "dateReceived: Date received isn't a real date.",
    );
  });

  it("trims a new tenant's name and takes 1 to 60 characters", () => {
    expect(paymentBody.parse({ ...payment, newTenantName: "  Hari  " }).newTenantName).toBe("Hari");
    expect(paymentBody.parse({ ...payment, newTenantName: "x".repeat(60) }).newTenantName).toHaveLength(60);
    expect(problem(paymentBody, { ...payment, newTenantName: "x".repeat(61) })).toBe(
      "newTenantName: Tenant name must be 1 to 60 characters.",
    );
    expect(problem(paymentBody, { ...payment, newTenantName: "  " })).toBe(
      "newTenantName: Tenant name must be 1 to 60 characters.",
    );
  });

  it("refuses control characters in a new tenant's name", () => {
    for (const newTenantName of ["Ha\nri", "Ha\tri", "Ha\u0000ri", "Ha\u001bri", "Ha\u2028ri"]) {
      expect(problem(paymentBody, { ...payment, newTenantName }), JSON.stringify(newTenantName)).toBe(
        "newTenantName: Tenant name cannot have line breaks or other control characters.",
      );
    }
  });

  it("checks the new tenant's details too", () => {
    const details = (tenancyFields: object) => ({ ...payment, newTenantName: "Hari", tenancy: tenancyFields });
    expect(problem(paymentBody, details({ moveIn: "2026-10-01", phone: "98765 43210", notes: "a\nb" }))).toBeNull();
    expect(problem(paymentBody, details({ moveIn: "1999-01-01" }))).toBe(
      "tenancy.moveIn: Move-in date must be a date from 2000 to 2100.",
    );
    expect(problem(paymentBody, details({ moveIn: "2026-10-01", phone: "98765\n43210" }))).toBe(
      "tenancy.phone: Phone cannot have line breaks or other control characters.",
    );
  });
});

describe("tenancyBody", () => {
  it("takes the tenant's name trimmed, 1 to 60 characters, with no control characters", () => {
    expect(tenancyBody.parse({ ...tenancy, tenant: " Asha " }).tenant).toBe("Asha");
    expect(problem(tenancyBody, { ...tenancy, tenant: "" })).toBe("tenant: Tenant name must be 1 to 60 characters.");
    expect(problem(tenancyBody, { ...tenancy, tenant: "a".repeat(61) })).toBe(
      "tenant: Tenant name must be 1 to 60 characters.",
    );
    expect(problem(tenancyBody, { ...tenancy, tenant: "As\nha" })).toBe(
      "tenant: Tenant name cannot have line breaks or other control characters.",
    );
  });

  describe("the tenant name on an edit and on a create", () => {
    // An edit sends back the name stored in the Tenants tab, which the service ignores. A hand-typed row can hold a name
    // a create would refuse, and that must not stop the owner from editing the phone, notes or dates.
    const hardNames = {
      "a name over 60 characters": "x".repeat(61),
      "a name over 100 characters": "x".repeat(150),
      "a name with a line break": "Asha\nK",
      "a name with a control character": "Asha\u0000K",
      "a blank name": "   ",
      "an empty name": "",
    };
    const edit = (tenant: string) => ({ ...tenancy, tenant, id: "t-1", expectedUpdatedAt: "2026-10-01T00:00:00.000Z" });

    it.each(Object.entries(hardNames))("accepts %s on an edit, and passes it on as it was stored", (_label, tenant) => {
      expect(problem(tenancyBody, edit(tenant))).toBeNull();
      expect(tenancyBody.parse(edit(tenant)).tenant).toBe(tenant);
    });

    it.each(Object.entries(hardNames))("refuses %s on a create", (_label, tenant) => {
      expect(problem(tenancyBody, { ...tenancy, tenant })).toMatch(/^tenant: Tenant name /);
    });

    it("still bounds the name on an edit, so a huge text is refused", () => {
      expect(problem(tenancyBody, edit("x".repeat(201)))).toBe("tenant: Tenant name is too long.");
    });

    it("still checks the rest of an edit: the fields, and expectedUpdatedAt", () => {
      expect(problem(tenancyBody, { ...edit("x".repeat(61)), fields: { moveIn: "1999-12-31" } })).toBe(
        "fields.moveIn: Move-in date must be a date from 2000 to 2100.",
      );
      expect(problem(tenancyBody, { ...tenancy, tenant: "x".repeat(61), id: "t-1" })).toBe(
        "expectedUpdatedAt: This page is out of date. Switch to another tab and back, then try again.",
      );
    });
  });

  it("takes a phone of up to 30 characters on one line", () => {
    const fields = (phone: string) => ({ ...tenancy, fields: { moveIn: "2026-10-01", phone } });
    expect(tenancyBody.parse(fields(" 98765 43210 ")).fields.phone).toBe("98765 43210");
    expect(problem(tenancyBody, fields("9".repeat(31)))).toBe("fields.phone: Phone can have at most 30 characters.");
    expect(problem(tenancyBody, fields("98765\t43210"))).toBe(
      "fields.phone: Phone cannot have line breaks or other control characters.",
    );
  });

  it("takes notes of up to 500 characters, with line breaks but no other control characters", () => {
    const fields = (notes: string) => ({ ...tenancy, fields: { moveIn: "2026-10-01", notes } });
    expect(tenancyBody.parse(fields("  Paid by cheque.\nCall in May.  ")).fields.notes).toBe(
      "Paid by cheque.\nCall in May.",
    );
    expect(problem(tenancyBody, fields("n".repeat(501)))).toBe("fields.notes: Notes can have at most 500 characters.");
    expect(problem(tenancyBody, fields("a\u0000b"))).toBe(
      "fields.notes: Notes cannot have control characters other than line breaks.",
    );
  });

  it("takes tenancy dates from 2000 to 2100: move-in, agreement end and advance date", () => {
    const fields = (more: object) => ({ ...tenancy, fields: { moveIn: "2026-10-01", ...more } });
    expect(problem(tenancyBody, fields({ agreementEnd: "2100-12-31", advanceDate: "2000-01-01" }))).toBeNull();
    expect(problem(tenancyBody, { ...tenancy, fields: { moveIn: "1999-12-31" } })).toBe(
      "fields.moveIn: Move-in date must be a date from 2000 to 2100.",
    );
    expect(problem(tenancyBody, fields({ agreementEnd: "2101-01-01" }))).toBe(
      "fields.agreementEnd: Agreement end must be a date from 2000 to 2100.",
    );
    expect(problem(tenancyBody, fields({ advanceDate: "1980-05-05" }))).toBe(
      "fields.advanceDate: Advance date must be a date from 2000 to 2100.",
    );
  });

  it("still takes a blank agreement end and advance date, and leaves a blank move-in to the service to explain", () => {
    expect(problem(tenancyBody, { ...tenancy, fields: { moveIn: "2026-10-01", agreementEnd: "", advanceDate: " " } })).toBeNull();
    expect(problem(tenancyBody, { ...tenancy, fields: { moveIn: "" } })).toBe("fields.moveIn: Move-in date is required.");
  });

  it("takes the id and expectedUpdatedAt a person was shown, up to 200 characters, and refuses a longer one", () => {
    const edit = { ...tenancy, id: "t-1", expectedUpdatedAt: "2026-10-01T00:00:00.000Z" };
    expect(problem(tenancyBody, { ...edit, id: "t".repeat(200), expectedUpdatedAt: "x".repeat(200) })).toBeNull();
    expect(problem(tenancyBody, { ...edit, id: "t".repeat(201) })).toMatch(/^id: /);
    expect(problem(tenancyBody, { ...edit, expectedUpdatedAt: "x".repeat(201) })).toMatch(/^expectedUpdatedAt: /);
  });

  it("still needs expectedUpdatedAt when an id is given", () => {
    expect(problem(tenancyBody, { ...tenancy, id: "t-1" })).toBe(
      "expectedUpdatedAt: This page is out of date. Switch to another tab and back, then try again.",
    );
  });
});

describe("moveOutBody", () => {
  it("takes the id and expectedUpdatedAt a person was shown, up to 200 characters, and refuses a longer one", () => {
    expect(problem(moveOutBody, { ...moveOut, id: "t".repeat(200), expectedUpdatedAt: "x".repeat(200) })).toBeNull();
    expect(problem(moveOutBody, { ...moveOut, id: "t".repeat(201) })).toMatch(/^id: /);
    expect(problem(moveOutBody, { ...moveOut, expectedUpdatedAt: "x".repeat(201) })).toMatch(/^expectedUpdatedAt: /);
  });

  it("takes a move-out date from 2000 to 2100", () => {
    expect(problem(moveOutBody, moveOut)).toBeNull();
    expect(problem(moveOutBody, { ...moveOut, moveOut: "2101-01-01" })).toBe(
      "moveOut: Move-out date must be a date from 2000 to 2100.",
    );
    expect(problem(moveOutBody, { ...moveOut, moveOut: "" })).toBe("moveOut: Move-out date is required.");
  });

  it("takes notes of up to 500 characters, with line breaks but no other control characters", () => {
    expect(moveOutBody.parse({ ...moveOut, notes: " Left the keys.\nAdvance returned. " }).notes).toBe(
      "Left the keys.\nAdvance returned.",
    );
    expect(problem(moveOutBody, { ...moveOut, notes: "n".repeat(501) })).toBe(
      "notes: Notes can have at most 500 characters.",
    );
    expect(problem(moveOutBody, { ...moveOut, notes: "a\u0007b" })).toBe(
      "notes: Notes cannot have control characters other than line breaks.",
    );
  });
});

describe("settingsBody", () => {
  it("takes portion names trimmed, 1 to 60 characters, with no control characters", () => {
    const named = (name: string) => ({ portions: [{ ...settings.portions[0], name }] });
    expect(settingsBody.parse(named("  Ground floor ")).portions[0].name).toBe("Ground floor");
    expect(problem(settingsBody, named(""))).toBe("portions.0.name: Portion name must be 1 to 60 characters.");
    expect(problem(settingsBody, named("a".repeat(61)))).toBe("portions.0.name: Portion name must be 1 to 60 characters.");
    expect(problem(settingsBody, named("Ground\nfloor"))).toBe(
      "portions.0.name: Portion name cannot have line breaks or other control characters.",
    );
  });
});
