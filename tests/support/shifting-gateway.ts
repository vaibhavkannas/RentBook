import { FakeGateway } from "./fake-gateway";

const isBlank = (value: unknown) => value === undefined || value === null || value === "";

/**
 * A FakeGateway whose appendRow behaves like Google's append with INSERT_ROWS: the new row goes right after
 * the FIRST contiguous block of non-blank rows from row 1. A blank row inside the tab therefore makes the new
 * row land on it and every row below move down by one. (FakeGateway alone appends at the very end.)
 *
 * Set `shift = false` to seed rows at the end, and use `afterAppend` to act as someone else who changes the
 * tab at the same moment as the append.
 */
export class ShiftingGateway extends FakeGateway {
  shift = true;
  afterAppend: ((tab: string) => void) | null = null;

  async appendRow(tab: string, row: unknown[]) {
    const grid = this.tabs.get(tab);
    const blank = grid ? grid.findIndex((cells) => cells.every(isBlank)) : -1;
    await super.appendRow(tab, row);
    if (this.shift && grid && blank !== -1) grid.splice(blank, 0, grid.pop()!);
    this.afterAppend?.(tab);
  }
}
