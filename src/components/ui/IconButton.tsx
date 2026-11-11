import type { ComponentProps } from "react";
import { framedIconButtonClasses, iconButtonClasses } from "@/lib/ui-classes";

type Props = Omit<ComponentProps<"button">, "className" | "aria-label"> & {
  /** What a screen reader says for it ("Next month"): the glyph alone says nothing. */
  label: string;
  /** Muted for a button that should not shout, such as the close of a sheet. */
  tone?: "default" | "muted";
  /** A border and the surface colour round it, for a button that holds an icon (the month arrows); "round" is a circle (refresh), "round-done" its green. */
  framed?: boolean | "round" | "round-done";
};

/** A 44 px square button that holds one glyph: the month and year arrows, the close of a sheet. */
export function IconButton({ label, tone = "default", framed = false, type = "button", children, ...rest }: Props) {
  return (
    <button type={type} {...rest} aria-label={label} className={framed ? framedIconButtonClasses(framed === true ? "square" : framed) : iconButtonClasses(tone)}>
      {children}
    </button>
  );
}
