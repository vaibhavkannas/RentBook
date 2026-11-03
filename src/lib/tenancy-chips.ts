import type { TenancySummary } from "@/lib/domain/tenancy";
import { isValidIsoDay } from "@/lib/domain/year-month";
import { formatDay, formatRupees } from "@/lib/format";

/**
 * The short facts a portion card shows about its current tenancy, advance first, then the agreement:
 * "Advance ₹ 20,000 held", "Advance returned", "Advance adjusted", "Agreement ends 15 Mar 2027".
 * An advance that is null or zero shows nothing. Given `today` (YYYY-MM-DD) and an agreement end that is a real day before
 * it, the chip says "Agreement ended 15 Mar 2027" instead; without `today` it never does.
 */
export function tenancyChips(summary: TenancySummary, today?: string): string[] {
  const chips: string[] = [];

  if (summary.advance !== null && summary.advance > 0) {
    if (summary.advanceStatus === "Refunded") chips.push("Advance returned");
    else if (summary.advanceStatus === "Adjusted") chips.push("Advance adjusted");
    else if (summary.advanceStatus === "Held") chips.push(`Advance ${formatRupees(summary.advance)} held`);
    else chips.push(`Advance ${formatRupees(summary.advance)}`);
  }

  const agreementEnd = summary.agreementEnd.trim();
  if (agreementEnd !== "") {
    const ended = today !== undefined && isValidIsoDay(today) && isValidIsoDay(agreementEnd) && agreementEnd < today;
    chips.push(`Agreement ${ended ? "ended" : "ends"} ${formatDay(agreementEnd)}`);
  }

  return chips;
}
