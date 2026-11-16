import type { AttentionItem, AttentionTone } from "@/lib/report-copy";

/**
 * What the collapsed "Needs attention" row says: how many things are due, the most pressing one (the first, as `attentionItems`
 * orders them) as its headline, how many others there are, and the tone of the most urgent kind among all of them (red if any
 * row is red, else amber, else neutral). Pure, so the words and the tone can be tested.
 */
export function attentionSummary(items: readonly AttentionItem[]): {
  count: number;
  headline: string;
  more: string | null;
  tone: AttentionTone;
} {
  const tone: AttentionTone = items.some((i) => i.tone === "danger") ? "danger" : items.some((i) => i.tone === "warn") ? "warn" : "neutral";
  return { count: items.length, headline: items[0]?.text ?? "", more: items.length > 1 ? `+${items.length - 1} more` : null, tone };
}
