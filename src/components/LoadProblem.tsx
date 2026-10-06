import Link from "next/link";

type Props = {
  /** What went wrong, in words the person can act on. */
  message: string;
  /** Where "Try again" leads: the page that failed. */
  retryHref: string;
};

/** The error block shown when a page cannot read the Sheet. */
export default function LoadProblem({ message, retryHref }: Props) {
  return (
    <div role="alert" className="mt-4 rounded-2xl bg-danger-bg p-4 text-danger-ink">
      <p className="font-medium">Can&apos;t load your Sheet</p>
      <p className="mt-1 text-sm">{message}</p>
      <Link
        href={retryHref}
        className="mt-3 inline-block min-h-11 rounded-xl border border-current px-4 py-2.5 text-sm font-medium"
      >
        Try again
      </Link>
    </div>
  );
}
