import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { IconTile } from "./IconTile";

/** A card that holds a group of rows (More): one box with a hairline between the rows. */
export function MenuGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">{children}</div>;
}

/** A row of a group that leads to another screen: an icon tile, its name and what it is for, and an arrow. 52 px at least. */
export function MenuRow({ href, icon, title, hint }: { href: string; icon: IconName; title: string; hint: string }) {
  return (
    <Link href={href} className="press flex min-h-12 items-center gap-3 px-3 py-2">
      <IconTile name={icon} />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium">{title}</span>
        <span className="block break-words text-sm text-muted">{hint}</span>
      </span>
      <Icon name="right" className="size-5 shrink-0 text-muted" />
    </Link>
  );
}
