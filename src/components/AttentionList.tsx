"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { attentionSummary } from "@/lib/attention-summary";
import type { AttentionItem, AttentionTone } from "@/lib/report-copy";
import { cx } from "@/lib/ui-classes";
import { LOOK } from "./attention-look";

/** The count's badge: the tone's ink as a fill, so it stands out from the tint it sits on. */
const BADGE: Record<AttentionTone, string> = {
  danger: "bg-danger-ink text-danger-bg",
  warn: "bg-warn-ink text-warn-bg",
  neutral: "bg-accent text-accent-ink",
};

/**
 * The "Needs attention" card when two or more things are due: one row, collapsed on every visit (nothing is remembered), with
 * the count, the most pressing headline and how many more; a tap opens the rows exactly as they were, each a tinted 44 px link.
 * The rows stay in the page while it is closed (the height animates), hidden from the keyboard and from screen readers. The state
 * is this card's own, so a tap draws the card and not the screen. It is given the items already worked out: it reads nothing.
 */
export default function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { count, headline, more, tone } = attentionSummary(items);
  return (
    <section aria-label="Needs attention" className="mt-3">
      <h2 className="sr-only">Needs attention</h2>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((now) => !now)}
        className={cx("press flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm", LOOK[tone].row)}
      >
        <Icon name={LOOK[tone].icon} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            Needs attention
            <span className={cx("grid min-w-5 place-items-center rounded-full px-1 text-xs font-semibold leading-5", BADGE[tone])}>{count}</span>
          </span>
          <span className="block break-words">
            {headline}
            {more && <span className="whitespace-nowrap opacity-80"> {more}</span>}
          </span>
        </span>
        <Icon name="right" className={cx("size-5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      <div id={panelId} className="accordion" data-open={open}>
        <div>
          <ul className="grid gap-2 pt-2">
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
        </div>
      </div>
    </section>
  );
}
