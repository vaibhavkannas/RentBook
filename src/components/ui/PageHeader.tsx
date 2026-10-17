import Link from "next/link";

type Props = {
  title: string;
  /** Where the arrow leads. `label` is what a screen reader says for it ("Back to month"). */
  back?: { href: string; label: string };
};

/** The title of a screen, with an arrow back to where the person came from. */
export function PageHeader({ title, back }: Props) {
  const heading = <h1 className="text-lg font-semibold">{title}</h1>;
  if (!back) return <header className="flex min-h-11 items-center gap-2">{heading}</header>;
  return (
    <nav className="flex min-h-11 items-center gap-2">
      <Link
        href={back.href}
        aria-label={back.label}
        className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
      >
        ‹
      </Link>
      {heading}
    </nav>
  );
}
