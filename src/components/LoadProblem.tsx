import { ButtonLink } from "@/components/ui/Button";

type Props = {
  /** What went wrong, in words the person can act on. */
  message: string;
  /** Where "Try again" leads: the page that failed. */
  retryHref: string;
  /** The bold first line. */
  title?: string;
  /** Where Set up is, for the owner when Set up can explain the problem: a second way on, beside Try again. */
  setupHref?: string;
};

/** The error block shown when a page cannot read the Sheet. */
export default function LoadProblem({ message, retryHref, title = "Can't load your Sheet", setupHref }: Props) {
  return (
    <div role="alert" className="mt-4 rounded-card bg-danger-bg p-4 text-danger-ink">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
      {setupHref === undefined ? (
        <ButtonLink href={retryHref} variant="outline" className="mt-3">
          Try again
        </ButtonLink>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href={retryHref} variant="outline">
            Try again
          </ButtonLink>
          <ButtonLink href={setupHref} variant="outline">
            Open Set up to see what is wrong
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
