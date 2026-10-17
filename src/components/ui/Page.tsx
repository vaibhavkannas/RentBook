import type { ComponentProps } from "react";
import { cx, pageClasses } from "@/lib/ui-classes";

type Props = Omit<ComponentProps<"main">, "className"> & {
  /** Centre the content vertically: the sign-in and error pages. */
  center?: boolean;
  /** Layout only. */
  className?: string;
};

/** The page: one phone-width column with a 16 px gutter. */
export function Page({ center = false, className, ...rest }: Props) {
  return <main {...rest} className={cx(pageClasses(center), className)} />;
}
