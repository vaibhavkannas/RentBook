import { Icon, type IconName } from "./Icon";

/** The rounded square with an icon at the start of a row on More. A decoration: the row says the same in words. */
export function IconTile({ name }: { name: IconName }) {
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-control bg-surface-2 text-accent">
      <Icon name={name} />
    </span>
  );
}
