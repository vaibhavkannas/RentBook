import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import LoadProblem from "@/components/LoadProblem";
import MoveOutForm from "@/components/MoveOutForm";
import TenancyForm from "@/components/TenancyForm";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { monthParam } from "@/lib/app-nav";
import { todayIso } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readWrittenAt } from "@/lib/server/freshness";
import { problemMessage } from "@/lib/server/problem";
import { getPortionTenants, type PortionTenants } from "@/lib/sheets/tenancy-service";
import { emptyMoveOutForm, emptyTenancyForm, tenancyFormText } from "@/lib/tenancy-input";
import { showChangedNotice, tenantsPagePath, TENANCY_CONFLICT_MESSAGE } from "@/lib/tenancy-response";
import {
  addDetailsHint,
  advanceOutcome,
  advanceSummary,
  lastUpdatedText,
  noCurrentTenancyNote,
  phoneHref,
  tenancyPeriod,
} from "@/lib/tenancy-view";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/** One label and value of the current tenancy. An empty value reads "Not added". */
function Detail({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right">
        {children || <span className="text-muted">Not added</span>}
      </dd>
    </div>
  );
}

/** Long text (notes) on a full-width row of its own, left-aligned, with its line breaks kept. */
function LongDetail({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-left">
        {children || <span className="text-muted">Not added</span>}
      </dd>
    </div>
  );
}

/** The title of the page, with its way back to the month screen. */
function Header({ title }: { title: string }) {
  return <PageHeader title={title} back={{ href: "/", label: "Back to month" }} />;
}

export default async function TenantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ portionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");

  const { portionId } = await params;
  // A form that met a conflict opens this page again with ?changed=1, so the notice is the page's own and stays
  // until the next normal visit or save. A normal visit never has it.
  const search = await searchParams;
  const changed = showChangedNotice(search);
  // The month the person opened this page from: the forms keep it in the address, and the arrow back leads to it.
  const monthKey = monthParam(search?.month);

  let data: PortionTenants | null = null;
  let problem: string | null = null;
  let unknownPortion = false;
  try {
    data = await getPortionTenants(getSheetsContext(), portionId, { minFetchedAt: await readWrittenAt(viewer.email) });
  } catch (error) {
    if (error instanceof AppError) {
      // getPortionTenants answers an id that is not one of the portions with a validation error; nothing else on this page does.
      if (error.code === "validation") unknownPortion = true;
      else problem = problemMessage(error, viewer);
    } else {
      problem = problemMessage(error, viewer);
    }
  }
  // notFound() throws, so it must stay outside the try block above.
  if (unknownPortion) notFound();

  if (!data) {
    return (
      <Page>
        <Header title="Tenant details" />
        <LoadProblem message={problem ?? "Couldn't reach Google Sheets. Try again."} retryHref={tenantsPagePath(portionId, monthKey)} />
      </Page>
    );
  }

  const { portion, scheduleTenant, current, mismatched, past, tenantsProblem } = data;

  // The Tenants tab cannot be used (a header was changed): say what is wrong. Rent logging does not need it.
  if (tenantsProblem !== undefined) {
    return (
      <Page>
        <Header title={portion.name} />
        <LoadProblem
          title="Can't show the tenant details"
          message={`${tenantsProblem} Put the header back, then try again. Logging rent and the other pages still work.`}
          retryHref={tenantsPagePath(portion.id, monthKey)}
        />
      </Page>
    );
  }
  const today = todayIso(new Date());
  const phoneLink = current ? phoneHref(current.phone) : null;
  const advance = current ? advanceSummary(current) : null;
  const note = current ? null : noCurrentTenancyNote({ scheduleTenant, mismatched, lastPast: past[0] });

  return (
    <Page>
      <Header title={portion.name} />
      {changed && (
        <Notice tone="warn" role="alert" className="mt-3 mb-2">
          {TENANCY_CONFLICT_MESSAGE}
        </Notice>
      )}
      <p className="mt-1 text-sm text-muted">
        {scheduleTenant === null ? "No tenant recorded yet." : `Tenant in the Schedule: ${scheduleTenant}`}
      </p>

      <Card as="section" aria-labelledby="current-heading" className="mt-4">
        <h2 id="current-heading" className="font-medium">
          Current tenancy
        </h2>

        {current ? (
          <>
            <p className="mt-1 font-medium">{current.tenant}</p>
            <dl className="mt-2 divide-y divide-line">
              <Detail label="Phone">
                {phoneLink ? (
                  <a href={phoneLink} className="press inline-flex min-h-11 items-center underline">
                    {current.phone}
                  </a>
                ) : (
                  current.phone
                )}
              </Detail>
              <Detail label="Moved in">{current.moveIn && formatDay(current.moveIn)}</Detail>
              <Detail label="Agreement ends">{current.agreementEnd.trim() && formatDay(current.agreementEnd.trim())}</Detail>
              <Detail label="Advance">{advance}</Detail>
              <LongDetail label="Notes">{current.notes}</LongDetail>
              <Detail label="Last updated">{lastUpdatedText(current)}</Detail>
            </dl>
            <TenancyForm
              key={`edit-${current.id}`}
              target={{
                mode: "edit",
                portionId: portion.id,
                tenant: current.tenant,
                id: current.id,
                expectedUpdatedAt: current.updatedAt,
              }}
              initial={tenancyFormText(current)}
              noticeShown={changed}
              monthKey={monthKey}
            />
          </>
        ) : scheduleTenant === null ? (
          <p className="mt-2 text-sm text-muted">
            Add a tenant from the month screen first. Then you can add their details here.
          </p>
        ) : (
          <>
            <h3 className="mt-2 text-sm font-medium">Add details</h3>
            <p className="mt-1 text-sm text-muted">{addDetailsHint(scheduleTenant)}</p>
            {note && <p className="mt-1 text-sm text-muted">{note}</p>}
            <TenancyForm
              key={`create-${scheduleTenant}`}
              target={{ mode: "create", portionId: portion.id, tenant: scheduleTenant }}
              initial={emptyTenancyForm(today)}
              noticeShown={changed}
              monthKey={monthKey}
            />
          </>
        )}
      </Card>

      {current && (
        <Card as="section" aria-labelledby="move-out-heading" className="mt-4">
          <h2 id="move-out-heading" className="font-medium">
            Move out
          </h2>
          <p className="mt-1 text-sm text-muted">
            Record that {current.tenant} has moved out. Your Schedule is not changed.
          </p>
          <MoveOutForm
            key={`move-out-${current.id}`}
            tenant={current.tenant}
            portionId={portion.id}
            noticeShown={changed}
            monthKey={monthKey}
            target={{
              id: current.id,
              expectedUpdatedAt: current.updatedAt,
              hasAdvance: current.advance !== null,
              initialNotes: current.notes,
            }}
            initial={emptyMoveOutForm(today, current)}
          />
        </Card>
      )}

      <section aria-labelledby="past-heading" className="mt-4">
        <h2 id="past-heading" className="font-medium">
          Past tenants
        </h2>
        {past.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No past tenants yet.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {past.map((tenancy) => {
              const outcome = advanceOutcome(tenancy);
              return (
                <Card as="li" key={tenancy.rowNumber}>
                  <p className="font-medium">{tenancy.tenant}</p>
                  <p className="mt-1 text-sm text-muted">{tenancyPeriod(tenancy.moveIn, tenancy.moveOut)}</p>
                  {outcome && <p className="mt-1 text-sm">{outcome}</p>}
                </Card>
              );
            })}
          </ul>
        )}
      </section>
    </Page>
  );
}
