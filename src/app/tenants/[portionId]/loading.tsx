import Link from "next/link";

/** Grey placeholder bar. It pulses, except for people who asked their device for less motion. */
const BAR = "rounded-lg bg-line animate-pulse motion-reduce:animate-none";

/**
 * Shown straight away when Details is tapped, while the page reads the Sheet. The back link works at once;
 * the title and the two cards are placeholders for the portion name, the current tenancy and the move-out section.
 */
export default function Loading() {
  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4" aria-busy="true">
      <nav className="flex items-center gap-2">
        <Link href="/" aria-label="Back to month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ‹
        </Link>
        <div aria-hidden="true" className={`h-6 w-40 ${BAR}`} />
      </nav>
      <p className="sr-only">Loading tenant details…</p>

      <div aria-hidden="true" className="mt-4 space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className={`h-5 w-32 ${BAR}`} />
        <div className={`h-4 w-full ${BAR}`} />
        <div className={`h-4 w-5/6 ${BAR}`} />
        <div className={`h-4 w-2/3 ${BAR}`} />
        <div className={`h-11 w-24 ${BAR}`} />
      </div>

      <div aria-hidden="true" className="mt-4 space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className={`h-5 w-24 ${BAR}`} />
        <div className={`h-4 w-3/4 ${BAR}`} />
        <div className={`h-11 w-28 ${BAR}`} />
      </div>
    </main>
  );
}
