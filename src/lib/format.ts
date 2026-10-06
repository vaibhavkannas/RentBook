import type { YearMonth } from "@/lib/domain/types";
import { monthName } from "@/lib/domain/year-month";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 5450 -> "₹ 5,450", 1234567 -> "₹ 12,34,567". */
export function formatRupees(amount: number): string {
  return `₹ ${rupees.format(amount)}`;
}

/** { year: 2026, month: 10 } -> "October 2026". */
export function formatMonthTitle(ym: YearMonth): string {
  return `${monthName(ym.month, true)} ${ym.year}`;
}
