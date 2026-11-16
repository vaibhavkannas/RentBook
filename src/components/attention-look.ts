import type { IconName } from "@/components/ui/Icon";
import type { AttentionTone } from "@/lib/report-copy";

/** Each tone's row: a tint and the colour of its words, and the icon that goes with it, so the colour is a hint and no more. */
export const LOOK: Record<AttentionTone, { row: string; icon: IconName }> = {
  danger: { row: "bg-danger-bg text-danger-ink", icon: "warn" },
  warn: { row: "bg-warn-bg text-warn-ink", icon: "bell" },
  neutral: { row: "bg-accent-soft text-accent", icon: "bell" },
};
