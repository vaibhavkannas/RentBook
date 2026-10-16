/** A cell's content as text: a cell with nothing in it is "". */
export const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));

/** True for a cell with nothing in it, or only spaces. */
export const isBlankCell = (cell: unknown) => cell === undefined || cell === null || String(cell).trim() === "";
