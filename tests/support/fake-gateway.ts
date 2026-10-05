import { colIndex, parseA1 } from "@/lib/sheets/a1";
import type { CellWrite, RowOverride, SheetsGateway } from "@/lib/sheets/gateway";

type Grid = unknown[][];

/**
 * In-memory SheetsGateway for tests. Formula cells are strings starting with
 * "=" and are returned as-is for every render mode (no evaluation).
 * cloneRow shifts relative row references (A5 -> A6) the way Google does for
 * a plain copy/paste; absolute rows ($5) are left alone. Methods listed in
 * `failOn` throw on every call while they stay listed.
 */
export class FakeGateway implements SheetsGateway {
  readonly tabs = new Map<string, Grid>();
  failOn = new Set<keyof SheetsGateway>();
  calls: string[] = [];

  constructor(initial: Record<string, Grid> = {}) {
    for (const [title, grid] of Object.entries(initial)) {
      this.tabs.set(title, grid.map((row) => [...row]));
    }
  }

  private grid(tab: string): Grid {
    const grid = this.tabs.get(tab);
    if (!grid) throw new Error(`No tab named ${tab}`);
    return grid;
  }

  private enter(method: keyof SheetsGateway) {
    this.calls.push(method);
    if (this.failOn.has(method)) throw new Error(`${method} failed`);
  }

  async listTabs() {
    this.enter("listTabs");
    return [...this.tabs.keys()];
  }

  async addTab(title: string) {
    this.enter("addTab");
    this.tabs.set(title, []);
  }

  async getValues(tab: string, a1: string) {
    this.enter("getValues");
    const range = parseA1(a1);
    const grid = this.grid(tab);
    const lastRow = range.endRow ?? grid.length;
    const out: Grid = [];
    for (let r = range.startRow; r <= Math.min(lastRow, grid.length); r++) {
      const row = grid[r - 1] ?? [];
      const endCol = range.endCol ?? row.length - 1;
      const slice = row.slice(range.startCol, Math.min(endCol, row.length - 1) + 1);
      while (slice.length > 0 && isEmpty(slice[slice.length - 1])) slice.pop();
      out.push(slice);
    }
    while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  async updateValues(writes: CellWrite[]) {
    this.enter("updateValues");
    for (const write of writes) {
      const range = parseA1(write.a1);
      const grid = this.grid(write.tab);
      write.values.forEach((values, dr) => {
        const rowIndex = range.startRow - 1 + dr;
        while (grid.length <= rowIndex) grid.push([]);
        values.forEach((value, dc) => {
          grid[rowIndex][range.startCol + dc] = value;
        });
      });
    }
  }

  async appendRow(tab: string, row: unknown[]) {
    this.enter("appendRow");
    this.grid(tab).push([...row]);
  }

  async cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ) {
    this.enter("cloneRow");
    const grid = this.grid(tab);
    const source = grid[fromRow - 1] ?? [];
    const delta = toRow - fromRow;
    const copy = source.map((cell) =>
      typeof cell === "string" && cell.startsWith("=") ? shiftRows(cell, delta) : cell,
    );
    for (const col of clearCols) delete copy[col];
    for (const { col, value } of overrides) copy[col] = value;
    while (grid.length < toRow) grid.push([]);
    grid[toRow - 1] = copy;
  }
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === "";
}

function shiftRows(formula: string, delta: number) {
  return formula.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (match, col, abs, row) =>
    abs === "$" ? match : `${col}${Number(row) + delta}`,
  );
}

/** Test helper: a cell by column letters and 1-based row. */
export function cell(fake: FakeGateway, tab: string, letters: string, row: number) {
  return fake.tabs.get(tab)?.[row - 1]?.[colIndex(letters)];
}
