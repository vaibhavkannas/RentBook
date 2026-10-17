import type { ReactNode } from "react";

type Props = {
  title: string;
  /** Optional: a button or link that leads on. */
  action?: ReactNode;
  /** A line of explanation under the title. */
  children?: ReactNode;
};

/** What a list shows when there is nothing in it: what is missing, why it matters, and a way on. */
export function EmptyState({ title, action, children }: Props) {
  return (
    <div className="py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
