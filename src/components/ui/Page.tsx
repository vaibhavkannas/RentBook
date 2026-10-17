import type { ComponentProps } from "react";
import { cx, pageClasses } from "@/lib/ui-classes";

type Props = Omit<ComponentProps<"main">, "className"> & {
  /** Centre the content vertically: the sign-in and error pages. */
  center?: boolean;
  /** False for a page that is shown without the tab bar (the sign-in page): it then needs no room for it. */
  tabBar?: boolean;
  /** Layout only. */
  className?: string;
};

/** The page: one phone-width column with a 16 px gutter, and room under it for the tab bar. */
export function Page({ center = false, tabBar = true, className, ...rest }: Props) {
  return <main {...rest} className={cx(pageClasses(center, tabBar), className)} />;
}
