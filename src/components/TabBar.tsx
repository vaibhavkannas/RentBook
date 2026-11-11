"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { monthParam, TABS, tabForPath, withMonth, type TabId } from "@/lib/app-nav";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cx } from "@/lib/ui-classes";
import { useAppNavigate } from "./useAppNavigate";

/** Each tab's icon, from the app's own set: a calendar, a list and three dots. */
const ICONS: Record<TabId, IconName> = { month: "month", activity: "list", more: "dots" };

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
                // The ring is drawn inside the link: the first and the last touch the edge of the screen, which would clip it.
                "press relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium focus-visible:-outline-offset-2",
                current ? "font-semibold text-accent" : "text-muted",
              )}
            >
              <Icon name={ICONS[tab.id]} className="size-6" />
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
