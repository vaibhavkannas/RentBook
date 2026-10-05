export type ValueRender = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";

export type CellWrite = { tab: string; a1: string; values: unknown[][] };

export type RowOverride = { col: number; value: string | number };

/**
 * The only surface the rest of the app uses to reach a spreadsheet. The real
 * implementation talks to Google Sheets; tests use an in-memory fake.
 * All writes are RAW: text is never interpreted as a formula.
 */
export interface SheetsGateway {
  listTabs(): Promise<string[]>;
  addTab(title: string): Promise<void>;
  /** Rows may be ragged and trailing empty cells are omitted. */
  getValues(tab: string, a1: string, render: ValueRender): Promise<unknown[][]>;
  updateValues(writes: CellWrite[]): Promise<void>;
  /** Appends one row after the last row of the tab's table. */
  appendRow(tab: string, row: unknown[]): Promise<void>;
  /**
   * Creates `toRow` as a copy of `fromRow` (values, formulas with relative
   * references adjusted, and formatting), then blanks `clearCols` and sets
   * `overrides`. Must be atomic: either the finished row exists or nothing
   * changed. Rows are 1-based, columns are 0-based.
   */
  cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ): Promise<void>;
}
