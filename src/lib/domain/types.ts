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
};

export type MonthView = {
  month: YearMonth;
  cards: PortionCard[];
  received: number;
  expected: number;
  paidCount: number;
};
