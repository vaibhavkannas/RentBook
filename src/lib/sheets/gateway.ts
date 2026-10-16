export type ValueRender = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";

export type RangeRequest = { tab: string; a1: string };

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
  /**
   * Reads several ranges with ONE request to Google, so the answers all describe the same moment and cost one
   * call against the quota. The answers come back in the order asked, each shaped like `getValues`' answer.
   * If any named tab is missing the whole read fails.
   */
  getManyValues(requests: RangeRequest[], render: ValueRender): Promise<unknown[][][]>;
  updateValues(writes: CellWrite[]): Promise<void>;
  /** Appends one row after the last row of the tab's table. */
  appendRow(tab: string, row: unknown[]): Promise<void>;
  /**
   * Creates `toRow` as a copy of `fromRow` (values, formulas with relative
   * references adjusted, and formatting), then blanks `clearCols` and sets
   * `overrides`. Rows are 1-based, columns are 0-based.
   *
   * Atomic: the copy, the blanking and the overrides go to Google as ONE
   * request, so either the finished row exists or nothing changed.
   * NOT atomic with anything before it: the copy OVERWRITES `toRow` whatever
   * it holds, without checking. A caller that read `toRow` to see that it was
   * empty has no guarantee it still is. Two people adding the same month at
   * the same moment can therefore both clone, and the second clone wipes
   * what was written onto the first. The caller narrows this by reading
   * `toRow` again right before the call, and by taking its own writes one at a
   * time (write-lock.ts); it cannot close it against another server process
   * or a person typing in the Sheet.
   */
  cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ): Promise<void>;
}
