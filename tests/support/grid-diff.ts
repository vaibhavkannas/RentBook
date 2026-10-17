import { expect } from "vitest";
import { colLetter } from "@/lib/sheets/a1";
import type { CellWrite } from "@/lib/sheets/gateway";
import type { FakeGateway } from "./fake-gateway";
import { parseA1 } from "./a1";

/** A cell with nothing in it, in whichever way a grid holds that. */
export const blank = (value: unknown) => (value === undefined || value === null || value === "" ? "" : value);

/** The cells (A1 style) of `tab` that hold something else in `after` than in `before`, blank cells counting as equal. */
export function changedCells(before: FakeGateway, after: FakeGateway, tab: string): string[] {
  const a = before.tabs.get(tab) ?? [];
  const b = after.tabs.get(tab) ?? [];
  const out: string[] = [];
  for (let r = 0; r < Math.max(a.length, b.length); r++) {
    const width = Math.max(a[r]?.length ?? 0, b[r]?.length ?? 0);
    for (let c = 0; c < width; c++) {
      if (!Object.is(blank(a[r]?.[c]), blank(b[r]?.[c]))) out.push(`${colLetter(c)}${r + 1}`);
    }
  }
  return out;
}

/** Every cell the writes put in `tab`, with the value written there. */
export function plannedCells(writes: CellWrite[], tab: string): Map<string, unknown> {
  const cells = new Map<string, unknown>();
  for (const write of writes.filter((candidate) => candidate.tab === tab)) {
    const start = parseA1(write.a1);
    write.values.forEach((values, dr) =>
      values.forEach((value, dc) => cells.set(`${colLetter(start.startCol + dc)}${start.startRow + dr}`, value)),
    );
  }
  return cells;
}

/** A copy of a fake's tabs, to compare with later. */
export const snapshotOf = (fake: FakeGateway) => structuredClone([...fake.tabs]);

/** The writes changed exactly what they say: no cell of `tabs` outside them differs, and each cell of theirs holds what they wrote. */
export function expectOnlyPlanned(before: FakeGateway, after: FakeGateway, writes: CellWrite[], tabs = ["Schedule", "Settings"]) {
  for (const tab of tabs) {
    const planned = plannedCells(writes, tab);
    const changed = changedCells(before, after, tab);
    expect(changed.filter((address) => !planned.has(address))).toEqual([]);
    for (const [address, value] of planned) {
      const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(address)!;
      const col = [...letters].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
      expect(blank(after.tabs.get(tab)?.[Number(row) - 1]?.[col])).toEqual(blank(value));
    }
  }
}
