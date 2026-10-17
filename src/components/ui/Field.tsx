"use client";

import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { cx, fieldControlClasses } from "@/lib/ui-classes";

/** What a Field hands to the control inside it, so the label, the hint and the error are all tied to it. */
type FieldWiring = { id: string; describedBy: string | undefined; invalid: boolean };

const FieldContext = createContext<FieldWiring | null>(null);

type FieldProps = {
  label: string;
  /** Always-visible help under the control. */
  hint?: ReactNode;
  /** What is wrong with the value, in plain words. It shows under the control and marks the control invalid. */
  error?: string | null;
  /** One control: an Input, a Select or a TextArea. */
  children?: ReactNode;
};

/**
 * A labelled form control. The control inside gets its id, `aria-describedby` (the hint, then the error) and
 * `aria-invalid` (only while there is an error) from here, so each field's message is read with the field.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = cx(hint ? hintId : null, error ? errorId : null) || undefined;
  return (
    <FieldContext value={{ id, describedBy, invalid: Boolean(error) }}>
      <div>
        <label htmlFor={id} className="block text-sm">
          <span className="text-muted">{label}</span>
          {children}
        </label>
        {hint && (
          <p id={hintId} className="mt-1 text-sm text-muted">
            {hint}
          </p>
        )}
        {error && (
          // role="alert": the message is read out when it appears, even where the control already has focus (focusing a
          // control that has it says nothing new). The forms also move focus to the first control with an error.
          <p id={errorId} role="alert" className="mt-1 text-sm text-danger-ink">
            {error}
          </p>
        )}
      </div>
    </FieldContext>
  );
}

/** The attributes a control takes from its Field (none, outside a Field). */
function useWiring(own: { id?: string; "aria-describedby"?: string }) {
  const field = useContext(FieldContext);
  return {
    id: own.id ?? field?.id,
    "aria-describedby": cx(own["aria-describedby"], field?.describedBy) || undefined,
    "aria-invalid": field?.invalid ? true : undefined,
  } as const;
}

type Own<T extends "input" | "select" | "textarea"> = Omit<ComponentProps<T>, "className">;

export function Input({ large = false, ...props }: Own<"input"> & { large?: boolean }) {
  const wiring = useWiring(props);
  return <input {...props} {...wiring} className={fieldControlClasses("input", large)} />;
}

export function Select(props: Own<"select">) {
  const wiring = useWiring(props);
  return <select {...props} {...wiring} className={fieldControlClasses()} />;
}

export function TextArea(props: Own<"textarea">) {
  const wiring = useWiring(props);
  return <textarea {...props} {...wiring} className={fieldControlClasses("textarea")} />;
}

/** A tick box on a full row that is at least 44 px tall, so the whole row is the tap target. */
export function Checkbox({ label, ...props }: Own<"input"> & { label: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" {...props} className="size-5 shrink-0" />
      <span>{label}</span>
    </label>
  );
}
