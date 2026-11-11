import type { ComponentProps } from "react";
import { cx } from "@/lib/ui-classes";

type Props = Omit<ComponentProps<"button">, "className" | "aria-pressed"> & {
  /** The choice is on now. */
  selected: boolean;
  /** How many things the choice would show. */
  count: number;
};

/**
 * A round choice that narrows a list on the screen (it changes no address): 44 px high, filled when it is on (`aria-pressed`),
 * with the number of things it shows after its label.
 */
export function FilterChip({ selected, count, type = "button", children, ...rest }: Props) {
  return (
    <button
      type={type}
      {...rest}
      aria-pressed={selected}
      className={cx(
        "press flex min-h-11 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm",
        selected ? "border-foreground bg-foreground text-background" : "border-line bg-surface text-foreground",
      )}
    >
      {children}
      <span className={cx("text-xs", selected ? "opacity-80" : "text-muted")}>{count}</span>
    </button>
  );
}
