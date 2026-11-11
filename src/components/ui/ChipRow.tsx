import { CHIP_ROW } from "@/lib/ui-classes";
import { ChipLink } from "./ChipLink";

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
 * A row of choices that narrow a list, drawn as 44 px round chips (ChipLink) that scroll sideways when they do not all fit. The chosen
 * one is filled in ink and marked `aria-current`. A tap replaces the history entry and keeps the scroll position: a choice
 * changes the view of a screen, it is not another screen to go back through. The row runs out to the edges of the
 * screen, with room round the chips for their focus ring (see CHIP_ROW).
 */
export function ChipRow({ label, chips }: Props) {
  return (
    <div role="group" aria-label={label} className={CHIP_ROW}>
      {chips.map((chip) => (
        <ChipLink key={chip.href} href={chip.href} replace scroll={false} selected={chip.selected}>
          {chip.label}
        </ChipLink>
      ))}
    </div>
  );
}
