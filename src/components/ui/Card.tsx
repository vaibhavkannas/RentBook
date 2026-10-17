import { createElement, type ComponentProps } from "react";
import { CARD, cx } from "@/lib/ui-classes";

type Props = Omit<ComponentProps<"div">, "className"> & {
  as?: "div" | "article" | "section" | "fieldset" | "li";
  /** Layout only: a margin. */
  className?: string;
};

/** The white box the app puts its content in. */
export function Card({ as = "div", className, ...rest }: Props) {
  return createElement(as, { ...rest, className: cx(CARD, className) });
}
