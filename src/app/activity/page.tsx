import Link from "next/link";
import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import { AppError } from "@/lib/errors";
import { formatMonthKey, formatRupees, formatSavedAt } from "@/lib/format";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readActivity, type ActivityItem } from "@/lib/sheets/service";

const PILL = {
  Logged: "bg-success-bg text-success-ink",
  Edited: "bg-warn-bg text-warn-ink",
  Undone: "bg-danger-bg text-danger-ink",
} as const;

export default async function ActivityPage() {
  if (!(await getViewer())) redirect("/signin");

  let items: ActivityItem[] | null = null;
  let problem: string | null = null;
  try {
    items = await readActivity(getSheetsContext());
  } catch (error) {
    if (error instanceof AppError) {
      problem = error.message;
    } else {
      console.error(error);
      problem = "Couldn't reach Google Sheets. Try again.";
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
      <nav className="flex items-center gap-2">
        <Link href="/" aria-label="Back to month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">Activity</h1>
      </nav>

      {problem && <LoadProblem message={problem} retryHref="/activity" />}

      {items && items.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">Nothing has been logged yet.</p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-3 space-y-3">
          {items.map((item, index) => (
            <li key={`${item.savedAt}-${index}`} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.portion}</p>
                {item.action ? (
                  <span className={`shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium ${PILL[item.action]}`}>
                    {item.action}
                  </span>
                ) : (
                  // An older row from before the Action column: nothing was recorded, so say nothing.
                  <span className="shrink-0 px-2.5 py-0.5 text-xs text-muted">
                    <span className="sr-only">No action recorded</span>
                    <span aria-hidden="true">—</span>
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">
                {item.tenant}
                {item.count !== null ? ` · Payment ${item.count}` : ""} · {formatMonthKey(item.month)}
              </p>
              {item.amount !== null && <p className="mt-1 text-lg font-medium">{formatRupees(item.amount)}</p>}
              <p className="mt-1 break-words text-sm text-muted">
                {formatSavedAt(item.savedAt)} · {item.loggedBy || "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
