import Link from "next/link";
import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { monthParam, withMonth } from "@/lib/app-nav";
import { agreementAlerts, hikeAlerts, type AgreementAlert, type HikeAlert } from "@/lib/domain/alerts";
import type { YearMonth } from "@/lib/domain/types";
import { currentYm, todayIso } from "@/lib/domain/year-month";
import {
  AGREEMENT_HINT,
  agreementPill,
  agreementSentence,
  ALERTS_FOOTNOTE,
  ALERTS_TENANTS_PROBLEM_NOTICE,
  hikePill,
  HIKE_MOVED_OUT_HINT,
  hikeSentence,
  HIKES_TENANTS_PROBLEM_NOTICE,
  NO_AGREEMENTS_TEXT,
  NO_HIKES_TEXT,
  showMovedOutHint,
} from "@/lib/report-copy";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { loadPageSnapshot } from "@/lib/server/freshness";
import { problemMessage, setupHrefFor } from "@/lib/server/problem";
import type { Snapshot } from "@/lib/sheets/service";
import { tenantsPagePath } from "@/lib/tenancy-response";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** An agreement that has ended or ends soon: the portion and its pill, the tenant, what is happening, and a way to the details. */
function Agreement({ alert, monthKey }: { alert: AgreementAlert; monthKey: string | null }) {
  const pill = agreementPill(alert);
  return (
    <Card as="li">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-medium">{alert.name}</h3>
        <Pill tone={pill.tone}>{pill.label}</Pill>
      </div>
      <p className="mt-0.5 text-sm text-muted">{alert.tenant}</p>
      <p className="mt-1 text-sm">{agreementSentence(alert)}</p>
      {alert.state === "ended" && <p className="mt-1 text-sm text-muted">{AGREEMENT_HINT}</p>}
      <Link
        href={tenantsPagePath(alert.portionId, monthKey)}
        aria-label={`Details for ${alert.name}`}
        className="press inline-flex min-h-11 min-w-11 items-center text-sm text-muted underline"
      >
        Details
      </Link>
    </Card>
  );
}

/** A rent hike that is due or coming: the portion and when, the tenant, and from what to what. */
function Hike({ alert, thisMonth }: { alert: HikeAlert; thisMonth: YearMonth }) {
  const pill = hikePill(alert);
  return (
    <Card as="li">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-medium">{alert.name}</h3>
        <Pill tone={pill.tone}>{pill.label}</Pill>
      </div>
      <p className="mt-0.5 text-sm text-muted">{alert.tenant}</p>
      <p className="mt-1 text-sm">{hikeSentence(alert)}</p>
      {alert.state === "due" && showMovedOutHint(alert.hikeMonth, thisMonth) && (
        <p className="mt-1 text-sm text-muted">{HIKE_MOVED_OUT_HINT}</p>
      )}
    </Card>
  );
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  // The month the person was looking at: Try again, the links to a tenant page and the arrow back keep it.
  const monthKey = monthParam((await searchParams)?.month);

  let snapshot: Snapshot | null = null;
  let problem: string | null = null;
  let setupHref: string | undefined;
  try {
    snapshot = await loadPageSnapshot(getSheetsContext(), viewer.email);
  } catch (error) {
    problem = problemMessage(error, viewer);
    setupHref = setupHrefFor(error, viewer, monthKey);
  }

  const now = new Date();
  const today = todayIso(now);
  const thisMonth = currentYm(now);
  const agreements = snapshot ? agreementAlerts(snapshot, today) : [];
  const hikes = snapshot ? hikeAlerts(snapshot, today) : [];

  return (
    <Page>
      <PageHeader title="Agreements and hikes" back={{ href: "/", label: "Back to month" }} />

      {problem && <LoadProblem message={problem} retryHref={withMonth("/alerts", monthKey)} setupHref={setupHref} />}

      {snapshot && (
        <>
          <section id="agreements" aria-labelledby="agreements-heading" className="mt-4">
            <h2 id="agreements-heading" className="font-medium">
              Agreements
            </h2>
            {snapshot.tenantsProblem !== undefined ? (
              // Without the Tenants tab no agreement is known, so "nothing ends soon" would be a guess.
              <Notice tone="warn" className="mt-2">
                {ALERTS_TENANTS_PROBLEM_NOTICE(snapshot.tenantsProblem)}
              </Notice>
            ) : agreements.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{NO_AGREEMENTS_TEXT}</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {agreements.map((alert) => (
                  <Agreement key={alert.portionId} alert={alert} monthKey={monthKey} />
                ))}
              </ul>
            )}
          </section>

          <section id="hikes" aria-labelledby="hikes-heading" className="mt-6">
            <h2 id="hikes-heading" className="font-medium">
              Rent hikes
            </h2>
            {snapshot.tenantsProblem !== undefined && hikes.length > 0 && (
              // Without the Tenants tab a hike for a tenant who left cannot be told apart from a real one.
              <Notice tone="warn" className="mt-2">
                {HIKES_TENANTS_PROBLEM_NOTICE(snapshot.tenantsProblem)}
              </Notice>
            )}
            {hikes.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{NO_HIKES_TEXT}</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {hikes.map((alert) => (
                  <Hike key={alert.portionId} alert={alert} thisMonth={thisMonth} />
                ))}
              </ul>
            )}
          </section>

          <p className="mt-4 text-sm text-muted">{ALERTS_FOOTNOTE}</p>
        </>
      )}
    </Page>
  );
}
