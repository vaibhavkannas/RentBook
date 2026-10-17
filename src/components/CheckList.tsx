import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SETUP_STEPS, statusPill, stepStatus, type Check, type SetupStep } from "@/lib/setup-checks";

type Props = {
  checks: readonly Check[];
  /** Something to show at the end of a step's card (a link, a sentence), by step. */
  extras?: Partial<Record<SetupStep, ReactNode>>;
};

function StatusPill({ status }: { status: Check["status"] }) {
  const { tone, label } = statusPill(status);
  return <Pill tone={tone}>{label}</Pill>;
}

/**
 * The checks of the Set up page, one card for each step: the step's name and its status, then each check with what it
 * found and, for a problem, what to do. It draws what it is given and holds nothing else.
 */
export default function CheckList({ checks, extras = {} }: Props) {
  return (
    <div className="mt-3 space-y-3">
      {SETUP_STEPS.map(({ step, title }) => {
        const own = checks.filter((check) => check.step === step);
        return (
          <Card as="section" key={step} aria-labelledby={`step-${step}`}>
            <div className="flex items-start justify-between gap-3">
              <h2 id={`step-${step}`} className="min-w-0 font-medium">
                {`${step}. ${title}`}
              </h2>
              <StatusPill status={stepStatus(checks, step)} />
            </div>
            <ul className="mt-3 space-y-3">
              {own.map((check) => (
                <li key={check.id}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-sm font-medium">{check.title}</p>
                    <StatusPill status={check.status} />
                  </div>
                  <p className="mt-1 break-words text-sm text-muted">{check.detail}</p>
                  {check.fix !== undefined && (
                    <p className="mt-1 break-words text-sm">
                      <span className="font-medium">To fix:</span> {check.fix}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {extras[step]}
          </Card>
        );
      })}
    </div>
  );
}
