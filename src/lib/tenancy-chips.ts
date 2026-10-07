import type { TenancySummary } from "@/lib/domain/tenancy";
import { formatDay, formatRupees } from "@/lib/format";

/**
 * The short facts a portion card shows about its current tenancy, advance first, then the agreement:
 * "Advance ₹ 20,000 held", "Advance returned", "Advance adjusted", "Agreement ends 15 Mar 2027".
 * An advance that is null or zero shows nothing.
 */
export function tenancyChips(summary: TenancySummary): string[] {
  const chips: string[] = [];

  if (summary.advance !== null && summary.advance > 0) {
    if (summary.advanceStatus === "Refunded") chips.push("Advance returned");
    else if (summary.advanceStatus === "Adjusted") chips.push("Advance adjusted");
    else if (summary.advanceStatus === "Held") chips.push(`Advance ${formatRupees(summary.advance)} held`);
    else chips.push(`Advance ${formatRupees(summary.advance)}`);
  }

  const agreementEnd = summary.agreementEnd.trim();
  if (agreementEnd !== "") chips.push(`Agreement ends ${formatDay(agreementEnd)}`);

  return chips;
}
