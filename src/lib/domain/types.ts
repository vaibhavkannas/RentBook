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
};

export type PortionEntry = { tenant: string; count: number; amount: number };

export type ScheduleRow = {
  /** 1-based row number in the Schedule tab. */
  rowNumber: number;
  month: YearMonth;
  entries: Record<string, PortionEntry | null>;
};

export type NextPayment = {
  tenant: string;
  count: number;
  suggestedAmount: number;
  previousAmount: number;
  startsNewCycle: boolean;
};

export type CardStatus = "paid" | "pending" | "needs-tenant";

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
