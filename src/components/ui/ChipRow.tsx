import { CHIP_ROW } from "@/lib/ui-classes";
import { ButtonLink } from "./Button";

export type Chip = {
  label: string;
  /** Where the chip leads: the same screen with this choice made. */
  href: string;
  /** The choice that is on now. */
  selected: boolean;
};

type Props = {
  /** What the row chooses ("Show"), for a screen reader. */
  label: string;
  chips: readonly Chip[];
};

/**
 * A row of choices that narrow a list, drawn as 44 px buttons that scroll sideways when they do not all fit. The chosen
 * one is filled and marked `aria-current`. A tap replaces the history entry and keeps the scroll position: a choice
 * changes the view of a screen, it is not another screen to go back through. The row runs out to the edges of the
 * screen, with room round the chips for their focus ring (see CHIP_ROW).
 */
export function ChipRow({ label, chips }: Props) {
  return (
    <div role="group" aria-label={label} className={CHIP_ROW}>
      {chips.map((chip) => (
        <ButtonLink
          key={chip.href}
          href={chip.href}
          replace
          scroll={false}
          variant={chip.selected ? "primary" : "secondary"}
          aria-current={chip.selected ? "true" : undefined}
          className="shrink-0 whitespace-nowrap"
        >
          {chip.label}
        </ButtonLink>
      ))}
    </div>
  );
}
