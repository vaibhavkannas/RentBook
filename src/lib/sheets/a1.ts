/** 0-based column index to letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function colLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Letters to 0-based column index: A -> 0, AA -> 26. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

export type A1Range = {
  startCol: number;
  endCol: number | null;
  startRow: number;
  endRow: number | null;
};

const A1_PATTERN = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/;

/** Parses "A1:ZZ", "B5", "A12:ZZ12". Missing rows mean "to the end". */
export function parseA1(a1: string): A1Range {
  const match = A1_PATTERN.exec(a1);
  if (!match) throw new Error(`Unsupported A1 range: ${a1}`);
  const startCol = colIndex(match[1]);
  const startRow = match[2] ? Number(match[2]) : 1;
  if (match[3] === undefined) {
    return { startCol, endCol: startCol, startRow, endRow: match[2] ? startRow : null };
  }
  return {
    startCol,
    endCol: colIndex(match[3]),
    startRow,
    endRow: match[4] ? Number(match[4]) : null,
  };
}
