"use client";

import { useEffect, useRef } from "react";
import type { FormProblem } from "@/lib/form-errors";

const keyOf = (name: string, row: string | null) => `${row ?? ""}\u0000${name}`;

/**
 * Moves focus to the field a problem is about, once the problem is on the screen: so a person who tapped Save and sees
 * nothing happen is taken to the field that is wrong, with its message beside it. Hand the result to each field as its
 * `ref`: `ref={field("amount")}`, or `field("hike", rowId)` in a form with a row for each portion. A problem with no
 * field (a message in the form's own box) moves nothing.
 */
export function useFieldFocus(problem: FormProblem | null) {
  const nodes = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (problem?.field) nodes.current.get(keyOf(problem.field, problem.row))?.focus();
  }, [problem]);

  return (name: string, row: string | null = null) =>
    (node: HTMLElement | null) => {
      if (node) nodes.current.set(keyOf(name, row), node);
      else nodes.current.delete(keyOf(name, row));
    };
}
