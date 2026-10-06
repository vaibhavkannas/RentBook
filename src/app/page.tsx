import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import PortionBoard from "@/components/PortionBoard";
import type { MonthView } from "@/lib/domain/types";
import { addMonths, currentYm, parseYmKey, todayIso, ymKey } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { formatMonthTitle, formatRupees } from "@/lib/format";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { loadMonthView } from "@/lib/server/freshness";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  if (!(await getViewer())) redirect("/signin");

  const { month: param } = await searchParams;
  const now = new Date();
  const month = (param ? parseYmKey(param) : null) ?? currentYm(now);

  let view: MonthView | null = null;
  let problem: string | null = null;
  try {
    view = await loadMonthView(getSheetsContext(), month);
  } catch (error) {
    if (error instanceof AppError) {
      problem = error.message;
    } else {
      console.error(error);
      problem = "Couldn't reach Google Sheets. Try again.";
    }
  }

  const prev = ymKey(addMonths(month, -1));
  const next = ymKey(addMonths(month, 1));
  const title = formatMonthTitle(month);
  const progress =
    view && view.expected > 0 ? Math.min(100, Math.round((view.received / view.expected) * 100)) : 0;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
      <nav className="flex items-center justify-between">
        <Link href={`/?month=${prev}`} aria-label="Previous month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">{title}</h1>
        <Link href={`/?month=${next}`} aria-label="Next month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ›
        </Link>
      </nav>

      {problem && (
        <div role="alert" className="mt-4 rounded-2xl bg-danger-bg p-4 text-danger-ink">
          <p className="font-medium">Can&apos;t load your Sheet</p>
          <p className="mt-1 text-sm">{problem}</p>
          <Link href={`/?month=${ymKey(month)}`} className="mt-3 inline-block min-h-11 rounded-xl border border-current px-4 py-2.5 text-sm font-medium">
            Try again
          </Link>
        </div>
      )}

      {view && (
        <>
          <section className="mt-3 rounded-2xl bg-surface p-4 ring-1 ring-line" aria-label="Month summary">
            <div className="flex items-baseline justify-between text-sm text-muted">
              <span>Received</span>
              <span>
                {view.paidCount} of {view.cards.length} portions
              </span>
            </div>
            <p className="mt-0.5 text-2xl font-semibold">
              {formatRupees(view.received)}{" "}
              <span className="text-sm font-normal text-muted">of {formatRupees(view.expected)}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
              <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
          </section>

          <PortionBoard
            monthKey={ymKey(month)}
            monthLabel={title}
            cards={view.cards}
            defaultDate={todayIso(now)}
          />
        </>
      )}

      <footer className="mt-6 flex items-center justify-between text-sm">
        <Link href="/settings" className="grid min-h-11 place-items-center text-muted underline">
          Portion settings
        </Link>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button type="submit" className="min-h-11 text-muted underline">
            Sign out
          </button>
        </form>
      </footer>
    </main>
  );
}
