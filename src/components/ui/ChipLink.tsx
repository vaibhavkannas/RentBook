import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "@/lib/ui-classes";

type Props = Omit<ComponentProps<typeof Link>, "className" | "aria-current"> & { selected: boolean };

/**
 * A round choice that is a link (Activity's filters change the address): the look of the month screen's FilterChip, 44 px high,
 * filled in ink when it is the choice, and marked `aria-current`.
 */
export function ChipLink({ selected, ...rest }: Props) {
  return (
    <Link
      {...rest}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "press flex min-h-11 flex-none items-center whitespace-nowrap rounded-full border px-4 text-sm",
        selected ? "border-foreground bg-foreground text-background" : "border-line bg-surface text-foreground",
      )}
    />
  );
}
