import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { AttentionItem, AttentionTone } from "@/lib/report-copy";
import { cx } from "@/lib/ui-classes";

/** The dot before a row: the tone's colour, as a hint only. The words of the row say the same, so no colour is needed to read it. */
const DOT: Record<AttentionTone, string> = {
  danger: "bg-danger-ink",
  warn: "bg-warn-ink",
  neutral: "bg-muted",
};

/**
 * The home screen's "Needs attention" card: a row for each thing that is due (overdue rent, agreements that have ended or end
 * soon, rent hikes), each a full-width 44 px link to the screen that explains it. It draws what `attentionItems` built and
 * nothing when that is empty. It has no state, so it is drawn on the server.
 */
export default function AttentionCard({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card as="section" aria-label="Needs attention" className="mt-3">
      <h2 className="text-sm text-muted">Needs attention</h2>
      <ul className="mt-1 divide-y divide-line">
        {items.map((item) => (
          <li key={`${item.href}-${item.text}`}>
            <Link href={item.href} className="press flex min-h-11 w-full items-center gap-3 py-1">
              <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-full", DOT[item.tone])} />
              <span className="min-w-0 flex-1">{item.text}</span>
              <span aria-hidden="true" className="text-xl text-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
