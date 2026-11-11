import { cx } from "@/lib/ui-classes";
import { Icon, type IconName } from "./Icon";

export type DotStatus = "paid" | "pending" | "overdue" | "vacant";

const LOOK: Record<DotStatus, { icon: IconName; classes: string }> = {
  paid: { icon: "check", classes: "bg-success-bg text-success-ink" },
  pending: { icon: "clock", classes: "bg-warn-bg text-warn-ink" },
  overdue: { icon: "bang", classes: "bg-danger-bg text-danger-ink" },
  vacant: { icon: "dash", classes: "bg-off-bg text-off-ink" },
};

/** The round mark at the start of a portion row: an icon in the status's colours. The status is said in words beside it. */
export function StatusDot({ status }: { status: DotStatus }) {
  const { icon, classes } = LOOK[status];
  return (
    <span aria-hidden="true" className={cx("grid size-9 shrink-0 place-items-center rounded-full", classes)}>
      <Icon name={icon} className="size-4.5 shrink-0" />
    </span>
  );
}
