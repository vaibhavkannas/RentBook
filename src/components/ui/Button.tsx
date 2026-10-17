import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClasses, cx, type ButtonSize, type ButtonVariant } from "@/lib/ui-classes";
import { Spinner } from "./Spinner";

type Look = { variant?: ButtonVariant; size?: ButtonSize };

type ButtonProps = ComponentProps<"button"> &
  Look & {
    /** The action is running: the button is disabled and busy, and shows a spinner. */
    pending?: boolean;
    /** What the button says while it is pending ("Saving…"). Without it the button keeps its own text. */
    pendingLabel?: string;
  };

/**
 * Every button in the app. `className` is for layout only (`w-full`, `flex-1`, a margin): the colours, the shape and
 * the 44 or 48 px height come from `variant` and `size`.
 */
export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  pendingLabel,
  type = "button",
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(buttonClasses(variant, size), className)}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** A link that looks like a button, with the same variants and sizes. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & Look) {
  return <Link {...rest} className={cx(buttonClasses(variant, size), className)} />;
}
