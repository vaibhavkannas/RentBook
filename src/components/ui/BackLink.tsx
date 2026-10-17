"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAppNavigate } from "@/components/useAppNavigate";
import { monthParam, withMonth } from "@/lib/app-nav";
import { iconButtonClasses } from "@/lib/ui-classes";

type Props = {
  /** The screen the arrow leads to: its path, without a month ("/" for the month screen, "/more"). */
  href: string;
  /** What a screen reader says for it ("Back to month"). */
  label: string;
};

/**
 * The arrow back in a page header. It leads to `href` in the month of the current address, and a tap goes back in the
 * history when the screen before this one is that screen in that month, so the month that was showing comes back
 * (see navAction in src/lib/app-nav.ts). It reads the address, so it is drawn inside Suspense.
 */
export function BackLink({ href, label }: Props) {
  const to = withMonth(href, monthParam(useSearchParams().get("month")));
  const { onNavigate } = useAppNavigate();
  return (
    <Link href={to} aria-label={label} onNavigate={(event) => onNavigate(to, event)} className={iconButtonClasses()}>
      ‹
    </Link>
  );
}

/** The same arrow without the month, for the moment before the address can be read. */
export function BackLinkFallback({ href, label }: Props) {
  return (
    <Link href={href} aria-label={label} className={iconButtonClasses()}>
      ‹
    </Link>
  );
}
