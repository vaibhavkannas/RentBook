import type { ReactNode } from "react";
import { pillClasses, type PillTone } from "@/lib/ui-classes";

/** A small label: the status of a card, a chip. */
export function Pill({ tone, children }: { tone: PillTone; children?: ReactNode }) {
  return <span className={pillClasses(tone)}>{children}</span>;
}
