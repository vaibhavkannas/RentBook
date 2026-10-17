import { describe, expect, it } from "vitest";
import {
  afterEdit,
  fieldFromServer,
  fieldProblem,
  isDetailField,
  NEW_TENANT_DETAIL_FIELDS,
  plainMessage,
  plainProblem,
  problemAt,
  serverProblem,
} from "@/lib/form-errors";

// Where a message goes: beside the field it is about when the form has that field, else in the form's own box.

describe("fieldFromServer", () => {
  it.each([
    ["amount", { field: "amount", row: null }],
    ["dateReceived", { field: "date", row: null }],
    ["newTenantName", { field: "tenantName", row: null }],
    ["tenancy.moveIn", { field: "moveIn", row: null }],
    ["tenancy.phone", { field: "phone", row: null }],
    ["tenancy.advanceDate", { field: "advanceDate", row: null }],
    ["fields.phone", { field: "phone", row: null }],
    ["fields.moveIn", { field: "moveIn", row: null }],
    ["fields.agreementEnd", { field: "agreementEnd", row: null }],
    ["fields.advance", { field: "advance", row: null }],
    ["fields.notes", { field: "notes", row: null }],
    ["portions.0.name", { field: "name", row: 0 }],
    ["portions.3.cycleLength", { field: "cycle", row: 3 }],
    ["portions.12.hikePercent", { field: "hike", row: 12 }],
    ["moveOut", { field: "moveOut", row: null }],
    ["refund", { field: "refund", row: null }],
    ["deductions", { field: "deductions", row: null }],
  ])("maps %s", (path, field) => {
    expect(fieldFromServer(path)).toEqual(field);
  });

  it.each([
    undefined,
    null,
    "",
    5,
    {},
    ["amount"],
    "month",
    "portionId",
    "id",
    "expectedUpdatedAt",
    "tenant",
    "token",
    "expected.count",
    "fields",
    "fields.unknownThing",
    "tenancy.",
    "tenancy.constructor",
    "portions.name",
    "portions.x.name",
    "portions.-1.name",
    "portions.0.id",
    "portions.0",
    "portions.0.name.extra",
    "a.fields.phone",
    "Amount",
  ])("maps %j to no field", (path) => {
    expect(fieldFromServer(path)).toBeNull();
  });
});

describe("a problem with no field", () => {
  it("is a message that goes in the form's own box", () => {
    const problem = plainProblem("You're offline.");
    expect(problem).toEqual({ message: "You're offline.", field: null, row: null });
    expect(plainMessage(problem)).toBe("You're offline.");
    expect(problemAt(problem, "amount")).toBeNull();
  });

  it("is nothing when there is no problem", () => {
    expect(plainMessage(null)).toBeNull();
    expect(problemAt(null, "amount")).toBeNull();
  });
});

describe("fieldProblem: a message about a field", () => {
  const known = ["amount", "date"];

  it("goes beside the field when the form has it, and not in the form's own box", () => {
    const problem = fieldProblem("Enter the amount received.", "amount", known);
    expect(problem).toEqual({ message: "Enter the amount received.", field: "amount", row: null });
    expect(problemAt(problem, "amount")).toBe("Enter the amount received.");
    expect(problemAt(problem, "date")).toBeNull();
    expect(plainMessage(problem)).toBeNull();
  });

  it("goes in the form's own box when the form has no such field, or the message has none", () => {
    expect(fieldProblem("Enter the new tenant's name.", "tenantName", known)).toEqual(plainProblem("Enter the new tenant's name."));
    expect(fieldProblem("Something.", null, known)).toEqual(plainProblem("Something."));
    expect(fieldProblem("Something.", undefined, known)).toEqual(plainProblem("Something."));
  });

  it("can name the row a field is in, for a form with a row for each portion", () => {
    const problem = fieldProblem("Hike must be a number from 0 to 100.", "hike", ["name", "cycle", "hike"], "p4");
    expect(problem.row).toBe("p4");
    expect(problemAt(problem, "hike", "p4")).toBe("Hike must be a number from 0 to 100.");
    expect(problemAt(problem, "hike", "p1")).toBeNull();
    expect(problemAt(problem, "hike")).toBeNull();
    expect(problemAt(problem, "cycle", "p4")).toBeNull();
  });
});

describe("serverProblem: what the server said", () => {
  const known = ["amount", "date", "tenantName", "phone", "moveIn"];

  it("goes beside the field the answer names, in the form's own field names", () => {
    expect(serverProblem({ code: "validation", message: "Amount must be a whole number.", details: { field: "amount" } }, known)).toEqual({
      message: "Amount must be a whole number.",
      field: "amount",
      row: null,
    });
    expect(serverProblem({ code: "validation", message: "Date received isn't a real date.", details: { field: "dateReceived" } }, known).field).toBe("date");
    expect(serverProblem({ code: "validation", message: "x", details: { field: "tenancy.moveIn" } }, known).field).toBe("moveIn");
    expect(serverProblem({ code: "validation", message: "x", details: { field: "fields.phone" } }, known).field).toBe("phone");
  });

  it("goes in the form's own box when the answer names no field, or one the form does not have", () => {
    expect(serverProblem({ code: "validation", message: "Words." }, known)).toEqual(plainProblem("Words."));
    expect(serverProblem({ code: "validation", message: "Words.", details: { field: "month" } }, known)).toEqual(plainProblem("Words."));
    expect(serverProblem({ code: "validation", message: "Words.", details: { field: "fields.notes" } }, known)).toEqual(plainProblem("Words."));
    expect(serverProblem({ code: "validation", message: "Words.", details: {} }, known)).toEqual(plainProblem("Words."));
  });

  it("says the words of apiErrorMessage: signed out, something went wrong, or the server's own", () => {
    expect(serverProblem({ code: "unauthorized", message: "Sign in with an allowed Google account." }, known).message).toBe(
      "You've been signed out. Reload the page to sign in again.",
    );
    expect(serverProblem(undefined, known).message).toBe("Something went wrong on our side. Try again.");
    expect(serverProblem({ code: "internal", message: "x" }, known).message).toBe("Something went wrong on our side. Try again.");
  });

  it("finds the row of a settings error by its position, and has no field for a row that is not there", () => {
    const rows = ["p1", "p2", "p3"];
    const fields = ["name", "cycle", "hike"];
    expect(
      serverProblem({ code: "validation", message: "Words.", details: { field: "portions.1.cycleLength" } }, fields, rows),
    ).toEqual({ message: "Words.", field: "cycle", row: "p2" });
    expect(
      serverProblem({ code: "validation", message: "Words.", details: { field: "portions.7.name" } }, fields, rows),
    ).toEqual(plainProblem("Words."));
    // a row field with no rows to look in
    expect(serverProblem({ code: "validation", message: "Words.", details: { field: "portions.0.name" } }, fields)).toEqual(
      plainProblem("Words."),
    );
  });

  it("does not take an inherited name for a field", () => {
    expect(serverProblem({ code: "validation", message: "Words.", details: { field: "constructor" } }, known)).toEqual(plainProblem("Words."));
  });
});

describe("afterEdit: typing in a field clears its error, and only its error", () => {
  const problem = fieldProblem("Enter the amount received.", "amount", ["amount", "date"]);

  it("clears the problem when the field typed in is the one it is about", () => {
    expect(afterEdit(problem, "amount")).toBeNull();
  });

  it("leaves it when another field is typed in", () => {
    expect(afterEdit(problem, "date")).toBe(problem);
  });

  it("clears a problem that is in the form's own box when anything is typed, because what it said may no longer hold", () => {
    const plain = plainProblem("Something went wrong.");
    expect(afterEdit(plain, "date")).toBeNull();
    expect(afterEdit(plain, "amount")).toBeNull();
  });

  it("keeps a row's problem when the same field is typed in in another row", () => {
    const row = fieldProblem("Hike must be a number.", "hike", ["name", "cycle", "hike"], "p4");
    expect(afterEdit(row, "hike", "p1")).toBe(row);
    expect(afterEdit(row, "hike", "p4")).toBeNull();
  });

  it("has nothing to clear when there is no problem", () => {
    expect(afterEdit(null, "amount")).toBeNull();
  });
});

describe("the details part of the New tenant sheet", () => {
  it("is the five fields inside the closed box, and no others", () => {
    expect([...NEW_TENANT_DETAIL_FIELDS].sort()).toEqual(["advance", "advanceDate", "agreementEnd", "moveIn", "phone"]);
    for (const field of NEW_TENANT_DETAIL_FIELDS) expect(isDetailField(field)).toBe(true);
    for (const field of ["amount", "date", "tenantName", "portion", null]) expect(isDetailField(field)).toBe(false);
  });
});
