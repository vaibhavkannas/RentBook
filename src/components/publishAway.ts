import type { AwayOutcome } from "@/lib/write-outcome";
import { writeNotices } from "@/lib/write-notices";

/**
 * Tells the owner what a save answered after its sheet was gone has to say: the notices that wait (outside every screen, see
 * WriteNotices), a toast for a plain failure, and a look at the Sheet again when what was sent may have been saved.
 */
export function publishAway(outcome: AwayOutcome, toast: { show: (text: string) => void }, refresh: () => void): void {
  for (const notice of outcome.notices) writeNotices.add(notice);
  if (outcome.toast) toast.show(outcome.toast);
  if (outcome.refresh) refresh();
}
