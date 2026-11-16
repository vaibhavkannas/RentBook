import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { AttentionItem } from "@/lib/report-copy";
import { cx } from "@/lib/ui-classes";
import AttentionList from "./AttentionList";
import { LOOK } from "./attention-look";

/**
 * The home screen's "Needs attention" card: a row for each thing that is due (overdue rent, agreements that have ended or end
 * soon, rent hikes), each a tinted, full-width 44 px link to the screen that explains it. It draws what `attentionItems` built:
 * nothing when that is empty; the one strip when there is a single item (nothing to collapse); and, for two or more, one
 * collapsed row that opens to the same rows (AttentionList, which is given the items and reads nothing). This entry has no state,
 * so it is drawn on the server.
 */
export default function AttentionCard({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) return null;
  if (items.length > 1) return <AttentionList items={items} />;
  return (
    <section aria-label="Needs attention" className="mt-3">
      <h2 className="sr-only">Needs attention</h2>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li key={`${item.href}-${item.text}`}>
            <Link
              href={item.href}
              className={cx("press flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-sm font-medium", LOOK[item.tone].row)}
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
