import { describe, expect, it } from "vitest";
import { FIELD_LABELS, fieldLabel, invalidFieldMessage } from "@/lib/field-labels";

// What a field is called in a message a person reads. A request body names its fields the way the code does
// (dateReceived, moveIn); the message names them the way the screen does.

describe("FIELD_LABELS", () => {
  it.each([
    ["amount", "Amount"],
    ["dateReceived", "Date received"],
    ["newTenantName", "Tenant name"],
    ["tenant", "Tenant name"],
    ["month", "Month"],
    ["portionId", "Portion"],
    ["phone", "Phone"],
    ["moveIn", "Move-in date"],
    ["agreementEnd", "Agreement end"],
    ["advance", "Advance"],
    ["advanceDate", "Advance date"],
    ["notes", "Notes"],
    ["moveOut", "Move-out date"],
    ["refund", "Refund"],
    ["deductions", "Deductions"],
    ["name", "Portion name"],
    ["cycleLength", "Payments per cycle"],
    ["hikePercent", "Hike"],
  ])("calls %s %s", (key, label) => {
    expect(FIELD_LABELS[key]).toBe(label);
  });

  it("has no label that is written the way the code writes a name: every label starts with a capital and has no camel case", () => {
    for (const label of Object.values(FIELD_LABELS)) {
      expect(label).toMatch(/^[A-Z][a-z]+(?:[- ][a-z]+)*$/);
    }
  });
});

describe("fieldLabel", () => {
  it("is the label of the last part of a path", () => {
    expect(fieldLabel(["amount"])).toBe("Amount");
    expect(fieldLabel(["fields", "phone"])).toBe("Phone");
    expect(fieldLabel(["tenancy", "moveIn"])).toBe("Move-in date");
    expect(fieldLabel(["portions", 0, "name"])).toBe("Portion name");
    expect(fieldLabel(["portions", 3, "cycleLength"])).toBe("Payments per cycle");
    expect(fieldLabel(["portions", 3, "hikePercent"])).toBe("Hike");
  });

  it("is null for a field it has no label for, so the caller says something general", () => {
    expect(fieldLabel(["token"])).toBeNull();
    expect(fieldLabel(["expected", "count"])).toBeNull();
    expect(fieldLabel(["fields", "unknownThing"])).toBeNull();
  });

  it("is null for an empty path, and for a path that ends at a position in a list", () => {
    expect(fieldLabel([])).toBeNull();
    expect(fieldLabel(["portions", 0])).toBeNull();
    expect(fieldLabel(["portions"])).toBeNull();
  });

  it("does not take the name of something every object has for a field", () => {
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(fieldLabel([key]), key).toBeNull();
    }
  });

  it("looks only at the last part: a label further up the path does not count", () => {
    expect(fieldLabel(["amount", "extra"])).toBeNull();
  });
});

describe("invalidFieldMessage", () => {
  it("names the field in a sentence that reads the same for any label, singular or plural", () => {
    expect(invalidFieldMessage("Amount")).toBe("The amount field isn't valid.");
    expect(invalidFieldMessage("Notes")).toBe("The notes field isn't valid.");
    expect(invalidFieldMessage("Deductions")).toBe("The deductions field isn't valid.");
    expect(invalidFieldMessage("Move-in date")).toBe("The move-in date field isn't valid.");
    expect(invalidFieldMessage("Payments per cycle")).toBe("The payments per cycle field isn't valid.");
  });

  it("is grammatical for every label there is: 'The ... field isn't valid.', never a label's own verb", () => {
    for (const label of Object.values(FIELD_LABELS)) {
      expect(invalidFieldMessage(label)).toMatch(/^The [a-z][a-z -]+ field isn't valid\.$/);
    }
  });
});
