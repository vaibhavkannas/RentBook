import { cx, SKELETON_BAR } from "@/lib/ui-classes";

/** A grey placeholder bar for a loading screen. `className` gives its size (`h-6 w-40`). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx(SKELETON_BAR, className)} />;
}
