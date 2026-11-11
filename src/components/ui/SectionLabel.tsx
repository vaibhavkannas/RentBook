import type { ReactNode } from "react";

/** The small uppercase heading that starts a group on a screen ("History", "Rent hikes"). It is a real heading, for a screen reader. */
export function SectionLabel({ as: Tag = "h2", id, className, children }: { as?: "h2" | "h3"; id?: string; className?: string; children?: ReactNode }) {
  return (
    <Tag id={id} className={`font-display text-xs font-semibold uppercase tracking-wider text-muted ${className ?? "mb-2 mt-5 px-0.5"}`}>
      {children}
    </Tag>
  );
}
