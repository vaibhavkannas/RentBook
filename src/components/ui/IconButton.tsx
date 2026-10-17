import type { ComponentProps } from "react";
import { iconButtonClasses } from "@/lib/ui-classes";

type Props = Omit<ComponentProps<"button">, "className" | "aria-label"> & {
  /** What a screen reader says for it ("Next month"): the glyph alone says nothing. */
  label: string;
  /** Muted for a button that should not shout, such as the close of a sheet. */
  tone?: "default" | "muted";
};

/** A 44 px square button that holds one glyph: the month and year arrows, the close of a sheet. */
export function IconButton({ label, tone = "default", type = "button", children, ...rest }: Props) {
  return (
    <button type={type} {...rest} aria-label={label} className={iconButtonClasses(tone)}>
      {children}
    </button>
  );
}
