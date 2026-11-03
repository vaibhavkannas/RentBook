import { agreementAlerts, hikeAlerts } from "@/lib/domain/alerts";
import { overdueList } from "@/lib/domain/overdue";
import type { RentSnapshot } from "@/lib/domain/types";
import { attentionItems, type AttentionItem } from "@/lib/report-copy";

/**
 * The rows of the home screen's "Needs attention" card on the India day `today`, from one snapshot: the overdue list, the
 * agreements that have ended or end soon, and the hikes that are due or coming, each by its own rule. Empty when nothing is
 * due. The links carry `monthKey`, the month on show.
 */
export function attentionFor(snapshot: RentSnapshot, today: string, monthKey: string | null): AttentionItem[] {
  return attentionItems({
    overdue: overdueList(snapshot, today),
    agreements: agreementAlerts(snapshot, today),
    hikes: hikeAlerts(snapshot, today),
    monthKey,
  });
}
