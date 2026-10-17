import { Children, type ReactNode } from "react";
import { cx, noticeClasses, type Tone } from "@/lib/ui-classes";

type Props = {
  tone: Tone;
  /** For `aria-describedby` from the dialog or field the notice explains. */
  id?: string;
  /** "alert" for an error the person must hear about now, "status" for a quiet update. */
  role?: "alert" | "status";
  /** A notice that holds more than a line of text (a paragraph and buttons) is a div. */
  as?: "p" | "div";
  /** Layout only: a margin. */
  className?: string;
  children?: ReactNode;
};

/** A short message in a tinted box. */
export function Notice({ tone, id, role, as: Tag = "p", className, children }: Props) {
  return (
    <Tag id={id} role={role} className={cx(noticeClasses(tone), className)}>
      {children}
    </Tag>
  );
}

const hasContent = (children: ReactNode) => Children.toArray(children).some((child) => child !== "");

/**
 * A status region that is on the page from the start, empty and plain, so that a screen reader announces the text
 * when it arrives in it. It takes the tone's box only while it has something to say.
 */
export function LiveNotice({
  tone,
  className,
  emptyClassName,
  children,
}: {
  tone: Tone;
  /** Layout only: a margin, applied together with the box. */
  className?: string;
  /** Layout only: a class for the time it is empty (a region that must not add room). */
  emptyClassName?: string;
  children?: ReactNode;
}) {
  const filled = hasContent(children);
  return (
    <div role="status" className={filled ? cx(noticeClasses(tone), className) : emptyClassName}>
      {filled ? children : null}
    </div>
  );
}
