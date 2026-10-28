import { describe, expect, it } from "vitest";
import {
  ADD_PORTION_FIELDS,
  addedPortionText,
  buildAddPortionRequest,
  moveInOrder,
  orderPositionText,
  PORTION_NAME_BLANK_MESSAGE,
  sameOrder,
} from "@/lib/portion-requests";

// What the Add a portion sheet sends, and what is wrong before it sends it; the order editor's moves. The server checks again.

const typed = { name: "Roof room", cycle: "11", never: false, hike: "5" };

describe("buildAddPortionRequest", () => {
  it("makes the body the add route takes: the name trimmed, the cycle a number, the hike a number", () => {
    expect(buildAddPortionRequest({ ...typed, name: "  Roof room  ", hike: " 7.5 " })).toEqual({
      ok: true,
      body: { name: "Roof room", cycleLength: 11, hikePercent: 7.5 },
    });
  });

  it("sends no cycle length when the count never resets, whatever the cycle box says", () => {
    expect(buildAddPortionRequest({ ...typed, never: true, cycle: "abc" })).toEqual({
      ok: true,
      body: { name: "Roof room", cycleLength: null, hikePercent: 5 },
    });
  });

  it("takes a hike of 0, 100 and a decimal, and a cycle of 1 and 120", () => {
    for (const hike of ["0", "100", "5.5"]) expect(buildAddPortionRequest({ ...typed, hike }).ok, hike).toBe(true);
    for (const cycle of ["1", "120"]) expect(buildAddPortionRequest({ ...typed, cycle }).ok, cycle).toBe(true);
  });

  it("says a blank name is missing, beside the name field", () => {
    for (const name of ["", "   "]) {
      expect(buildAddPortionRequest({ ...typed, name })).toEqual({ ok: false, message: PORTION_NAME_BLANK_MESSAGE, field: "name" });
    }
    expect(PORTION_NAME_BLANK_MESSAGE).toBe("Enter the portion's name.");
  });

  it("says a name of more than 60 characters is too long, in the words of the settings form", () => {
    expect(buildAddPortionRequest({ ...typed, name: "a".repeat(61) })).toEqual({
      ok: false,
      message: "Portion name must be 1 to 60 characters.",
      field: "name",
    });
    expect(buildAddPortionRequest({ ...typed, name: "a".repeat(60) }).ok).toBe(true);
  });

  it("refuses a cycle that is not a whole number from 1 to 120, and says how to stop the count resetting", () => {
    for (const cycle of ["", "0", "121", "1.5", "-3", "eleven", "1e2"]) {
      const request = buildAddPortionRequest({ ...typed, cycle });
      expect(request, cycle).toEqual({
        ok: false,
        message: 'Payments per cycle must be a whole number from 1 to 120. To stop the count resetting, tick "Count never resets".',
        field: "cycle",
      });
    }
  });

  it("refuses a hike that is not a number from 0 to 100", () => {
    for (const hike of ["", "-1", "101", "5,5", "five", "5%"]) {
      expect(buildAddPortionRequest({ ...typed, hike }), hike).toEqual({
        ok: false,
        message: "Hike must be a number from 0 to 100. Use a dot for decimals, like 5.5.",
        field: "hike",
      });
    }
  });

  it("names the first thing wrong, in the order the fields are on the screen: name, cycle, hike", () => {
    expect(buildAddPortionRequest({ name: "", cycle: "x", never: false, hike: "x" })).toMatchObject({ field: "name" });
    expect(buildAddPortionRequest({ ...typed, cycle: "x", hike: "x" })).toMatchObject({ field: "cycle" });
    expect(buildAddPortionRequest({ ...typed, hike: "x" })).toMatchObject({ field: "hike" });
  });

  it("only names fields the sheet has", () => {
    expect(ADD_PORTION_FIELDS).toEqual(["name", "cycle", "hike"]);
    for (const request of [
      buildAddPortionRequest({ ...typed, name: "" }),
      buildAddPortionRequest({ ...typed, cycle: "x" }),
      buildAddPortionRequest({ ...typed, hike: "x" }),
    ]) {
      expect(request.ok).toBe(false);
      if (!request.ok) expect(ADD_PORTION_FIELDS).toContain(request.field);
    }
  });
});

describe("moveInOrder", () => {
  const ids = ["p1", "p2", "p3", "p4"];

  it("moves one portion up or down by swapping it with its neighbour", () => {
    expect(moveInOrder(ids, 1, -1)).toEqual(["p2", "p1", "p3", "p4"]);
    expect(moveInOrder(ids, 1, 1)).toEqual(["p1", "p3", "p2", "p4"]);
    expect(moveInOrder(ids, 3, -1)).toEqual(["p1", "p2", "p4", "p3"]);
    expect(moveInOrder(ids, 0, 1)).toEqual(["p2", "p1", "p3", "p4"]);
  });

  it("leaves the order as it is at the ends, and for a place that is not there", () => {
    expect(moveInOrder(ids, 0, -1)).toEqual(ids);
    expect(moveInOrder(ids, 3, 1)).toEqual(ids);
    expect(moveInOrder(ids, -1, 1)).toEqual(ids);
    expect(moveInOrder(ids, 4, -1)).toEqual(ids);
    expect(moveInOrder(ids, 1.5, 1)).toEqual(ids);
    expect(moveInOrder([], 0, 1)).toEqual([]);
  });

  it("moves by one place only", () => {
    expect(moveInOrder(ids, 0, 2)).toEqual(ids);
    expect(moveInOrder(ids, 3, -3)).toEqual(ids);
    expect(moveInOrder(ids, 1, 0)).toEqual(ids);
  });

  it("never changes the list it is given, and always answers a new one", () => {
    const given = Object.freeze([...ids]);
    const moved = moveInOrder(given, 1, 1);
    expect(given).toEqual(ids);
    expect(moved).not.toBe(given);
    expect(moveInOrder(given, 0, -1)).not.toBe(given);
  });

  it("keeps every id exactly once", () => {
    let order = ids;
    for (const [index, delta] of [[0, 1], [1, 1], [2, 1], [3, -1], [2, -1], [1, -1]] as const) order = moveInOrder(order, index, delta);
    expect([...order].sort()).toEqual(ids);
  });
});

describe("sameOrder", () => {
  it("is true for the same ids in the same places, and false for any difference", () => {
    expect(sameOrder(["p1", "p2"], ["p1", "p2"])).toBe(true);
    expect(sameOrder(["p1", "p2"], ["p2", "p1"])).toBe(false);
    expect(sameOrder(["p1"], ["p1", "p2"])).toBe(false);
    expect(sameOrder([], [])).toBe(true);
  });
});

describe("orderPositionText", () => {
  it("says where the portion is now, counting from 1", () => {
    expect(orderPositionText("Ground floor", 0, 5)).toBe("Ground floor is now 1 of 5.");
    expect(orderPositionText("Roof room", 4, 5)).toBe("Roof room is now 5 of 5.");
  });
});

describe("addedPortionText", () => {
  const columns = [
    { header: "Tenant6", letter: "R" },
    { header: "Count6", letter: "S" },
    { header: "Amount6", letter: "T" },
  ];

  it("says the portion was added and where its three columns are in the Schedule", () => {
    expect(addedPortionText("Roof room", columns)).toBe(
      "Roof room added. Its columns in your Schedule are Tenant6 (R), Count6 (S) and Amount6 (T).",
    );
  });

  it("copes with columns that are not side by side, and with two letters", () => {
    expect(
      addedPortionText("Annex", [
        { header: "Tenant 7", letter: "AC" },
        { header: "Count 7", letter: "AD" },
        { header: "Amount 7", letter: "AE" },
      ]),
    ).toBe("Annex added. Its columns in your Schedule are Tenant 7 (AC), Count 7 (AD) and Amount 7 (AE).");
  });
});
