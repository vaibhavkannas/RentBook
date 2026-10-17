"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { monthParam, TABS, tabForPath, withMonth, type TabId } from "@/lib/app-nav";
import { cx } from "@/lib/ui-classes";
import { useAppNavigate } from "./useAppNavigate";

/** Each tab's icon: 24 px, drawn in the colour of the label. A calendar, a list and three dots. */
const ICONS: Record<TabId, ReactNode> = {
  month: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </>
  ),
  activity: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
};

/**
 * A small dot that shows while the next screen loads: for a Link navigation (useLinkStatus, which must sit inside the
 * Link) and for a replace (`replacing`). It is always there at a fixed size and only fades in, after a moment, so a fast
 * navigation shows nothing and the bar never shifts.
 */
function PendingDot({ replacing }: { replacing: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={cx(
        "absolute left-1/2 top-2.5 ml-3 size-1.5 rounded-full bg-accent transition-opacity motion-reduce:transition-none",
        pending || replacing ? "opacity-100 delay-100" : "opacity-0",
      )}
    />
  );
}

/** The bar for a month: the month is in every link, so a tab leads to the same month. */
function TabBarView({ month }: { month: string | null }) {
  const pathname = usePathname();
  const active = tabForPath(pathname);
  const { onNavigate, replacingHref } = useAppNavigate();
  // The sign-in page, a page that was not found and the like are not under a tab, and have no bar.
  if (active === null) return null;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 h-tabbar border-t border-line bg-surface">
      <div className="mx-auto flex h-full max-w-md">
        {TABS.map((tab) => {
          const href = withMonth(tab.path, month);
          const current = tab.id === active;
          return (
            <Link
              key={tab.id}
              href={href}
              aria-current={current ? "page" : undefined}
              onNavigate={(event) => onNavigate(href, event)}
              className={cx(
                "press relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                current ? "text-accent" : "text-muted",
              )}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-6"
              >
                {ICONS[tab.id]}
              </svg>
              {tab.label}
              <PendingDot replacing={replacingHref === href} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** The bar for the root layout: it reads the month from the address, so it sits inside a Suspense boundary. */
export default function TabBar() {
  return <TabBarView month={monthParam(useSearchParams().get("month"))} />;
}

/** The same bar without the month, for the moment before the address can be read. */
export function TabBarFallback() {
  return <TabBarView month={null} />;
}
