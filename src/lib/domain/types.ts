import type { TenancySummary } from "./tenancy";

export type YearMonth = { year: number; month: number };

export type PortionConfig = {
  id: string;
  name: string;
  tenantHeader: string;
  countHeader: string;
  amountHeader: string;
  /** Payments per cycle. null means the count never resets. */
  cycleLength: number | null;
  hikePercent: number;
  /**
   * True when the owner switched the portion off (Settings column H, "Active", reads no). Absent, not false, for a portion that is
   * on, so a Sheet with no Active column reads exactly as it always has. A switched-off portion keeps its history: it is on the
   * month screen only in a month it has an entry for, and no new entry is logged for it.
   */
  inactive?: boolean;
};

export type PortionEntry = { tenant: string; count: number; amount: number };

export type ScheduleRow = {
  /** 1-based row number in the Schedule tab. */
  rowNumber: number;
  month: YearMonth;
  /** By portion id. A Map, because ids are typed by hand and `__proto__` or `constructor` must be plain ids. */
  entries: Map<string, PortionEntry | null>;
};

export type NextPayment = {
  tenant: string;
  count: number;
  suggestedAmount: number;
  previousAmount: number;
  startsNewCycle: boolean;
};

/**
 * "needs-tenant" is a portion that never had a tenant; "vacant" one whose last tenant moved out (see vacancy.ts). Neither has
 * rent due.
 */
export type CardStatus = "paid" | "pending" | "needs-tenant" | "vacant";

/** A portion whose last tenant has moved out: since when (YYYY-MM-DD, the move-out day) and who, as the Schedule names them. */
export type Vacancy = { since: string; previousTenant: string };

export type PortionCard = {
  portionId: string;
  name: string;
  cycleLength: number | null;
  status: CardStatus;
  entry: PortionEntry | null;
  next: NextPayment | null;
  /**
   * The rent this month is measured against: the app's suggested amount (the previous amount, plus
   * the hike on a new cycle). Null when there is nothing earlier to measure against: no earlier
   * entry, or a paid card for a new tenant's first payment.
   */
  rentReference: number | null;
  /**
   * For a paid card with a reference, the amount entered minus the reference: positive when more
   * than the rent was paid, negative when less. Null otherwise.
   */
  rentDifference: number | null;
  /** For a paid card that cannot be undone, the reason. Null otherwise. */
  undoBlockedReason: string | null;
  /**
   * The portion's current tenancy, when its tenant name matches the tenant this card shows.
   * Null when there are no details yet, or the details are for a different tenant name.
   */
  tenancy: TenancySummary | null;
  /**
   * Set on a vacant card: since when and who moved out. Null on every other card. Always set by `deriveMonthView`; optional
   * so that a card built by hand (a test's) still compiles.
   */
  vacancy?: Vacancy | null;
  /**
   * True on the card of a portion that is switched off (it is on the screen only in a month it has an entry for). Absent on every
   * other card.
   */
  inactive?: boolean;
};

export type MonthView = {
  month: YearMonth;
  cards: PortionCard[];
  /** What has been entered as paid this month. */
  received: number;
  /**
   * The rent due: for each portion its reference rent, or the amount entered when a paid card has
   * no reference. Extra or short payments do not move it.
   */
  due: number;
  /** Extra (positive) or short (negative) across the paid cards that have a reference rent. */
  difference: number;
  paidCount: number;
};
