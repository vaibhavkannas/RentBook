"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ButtonSize, ButtonVariant } from "@/lib/ui-classes";
import { Button } from "./Button";

type Props = {
  children?: ReactNode;
  /** What the button says while the form is being sent. */
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

/** The submit button of a form that runs a server action (sign in, sign out): it shows the form's pending state. */
export function SubmitButton({ children, pendingLabel, variant = "primary", size = "lg", className }: Props) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} pending={pending} pendingLabel={pendingLabel} className={className}>
      {children}
    </Button>
  );
}
