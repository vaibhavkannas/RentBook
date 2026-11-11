import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { AttentionItem, AttentionTone } from "@/lib/report-copy";
import { cx } from "@/lib/ui-classes";

/** Each tone's row: a tint and the colour of its words, and the icon that goes with it, so the colour is a hint and no more. */
const LOOK: Record<AttentionTone, { row: string; icon: IconName }> = {
  danger: { row: "bg-danger-bg text-danger-ink", icon: "warn" },
  warn: { row: "bg-warn-bg text-warn-ink", icon: "bell" },
  neutral: { row: "bg-accent-soft text-accent", icon: "bell" },
};

/**
 * The home screen's "Needs attention" rows: one for each thing that is due (overdue rent, agreements that have ended or end
 * soon, rent hikes), each a tinted, full-width 44 px link to the screen that explains it. It draws what `attentionItems` built
 * and nothing when that is empty. It has no state, so it is drawn on the server.
 */
export default function AttentionCard({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Needs attention" className="mt-3">
      <h2 className="sr-only">Needs attention</h2>
      <ul className="grid gap-1.5">
        {items.map((item) => (
          <li key={`${item.href}-${item.text}`}>
            <Link
              href={item.href}
              className={cx("press flex min-h-11 w-full items-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium", LOOK[item.tone].row)}
            >
              <Icon name={LOOK[item.tone].icon} />
              <span className="min-w-0 flex-1">{item.text}</span>
              <Icon name="right" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
