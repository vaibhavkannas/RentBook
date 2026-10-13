import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import LoadProblem from "@/components/LoadProblem";
import MoveOutForm from "@/components/MoveOutForm";
import TenancyForm from "@/components/TenancyForm";
import { todayIso } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readWrittenAt } from "@/lib/server/freshness";
import { getPortionTenants, type PortionTenants } from "@/lib/sheets/tenancy-service";
import { emptyMoveOutForm, emptyTenancyForm, tenancyFormText } from "@/lib/tenancy-input";
import { showChangedNotice, TENANCY_CONFLICT_MESSAGE } from "@/lib/tenancy-response";
import {
  addDetailsHint,
  advanceOutcome,
  advanceSummary,
  lastUpdatedText,
  noCurrentTenancyNote,
  phoneHref,
  tenancyPeriod,
} from "@/lib/tenancy-view";

const CARD = "rounded-2xl border border-line bg-surface p-4";

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

function Header({ title }: { title: string }) {
  return (
    <nav className="flex items-center gap-2">
      <Link href="/" aria-label="Back to month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
        ‹
      </Link>
      <h1 className="text-lg font-semibold">{title}</h1>
    </nav>
  );
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
  const changed = showChangedNotice(await searchParams);

  let data: PortionTenants | null = null;
  let problem: string | null = null;
  let unknownPortion = false;
  try {
    data = await getPortionTenants(getSheetsContext(), portionId, { minFetchedAt: await readWrittenAt() });
  } catch (error) {
    if (error instanceof AppError) {
      // getPortionTenants answers an id that is not one of the portions with a validation error; nothing else on this page does.
      if (error.code === "validation") unknownPortion = true;
      else problem = error.message;
    } else {
      console.error(error);
      problem = "Couldn't reach Google Sheets. Try again.";
    }
  }
  // notFound() throws, so it must stay outside the try block above.
  if (unknownPortion) notFound();

  if (!data) {
    return (
      <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
        <Header title="Tenant details" />
        <LoadProblem message={problem ?? "Couldn't reach Google Sheets. Try again."} retryHref={`/tenants/${encodeURIComponent(portionId)}`} />
      </main>
    );
  }

  const { portion, scheduleTenant, current, mismatched, past, tenantsProblem } = data;

  // The Tenants tab cannot be used (a header was changed): say what is wrong. Rent logging does not need it.
  if (tenantsProblem !== undefined) {
    return (
      <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
        <Header title={portion.name} />
        <LoadProblem
          title="Can't show the tenant details"
          message={`${tenantsProblem} Put the header back, then try again. Logging rent and the other pages still work.`}
          retryHref={`/tenants/${encodeURIComponent(portion.id)}`}
        />
      </main>
    );
  }
  const today = todayIso(new Date());
  const phoneLink = current ? phoneHref(current.phone) : null;
  const advance = current ? advanceSummary(current) : null;
  const note = current ? null : noCurrentTenancyNote({ scheduleTenant, mismatched, lastPast: past[0] });

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
      <Header title={portion.name} />
      {changed && (
        <p role="alert" className="mt-3 mb-2 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          {TENANCY_CONFLICT_MESSAGE}
        </p>
      )}
      <p className="mt-1 text-sm text-muted">
        {scheduleTenant === null ? "No tenant recorded yet." : `Tenant in the Schedule: ${scheduleTenant}`}
      </p>

      <section aria-labelledby="current-heading" className={`mt-4 ${CARD}`}>
        <h2 id="current-heading" className="font-medium">
          Current tenancy
        </h2>

        {current ? (
          <>
            <p className="mt-1 font-medium">{current.tenant}</p>
            <dl className="mt-2 divide-y divide-line">
              <Detail label="Phone">
                {phoneLink ? (
                  <a href={phoneLink} className="inline-flex min-h-11 items-center underline">
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
            />
          </>
        )}
      </section>

      {current && (
        <section aria-labelledby="move-out-heading" className={`mt-4 ${CARD}`}>
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
            target={{
              id: current.id,
              expectedUpdatedAt: current.updatedAt,
              hasAdvance: current.advance !== null,
              initialNotes: current.notes,
            }}
            initial={emptyMoveOutForm(today, current)}
          />
        </section>
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
                <li key={tenancy.rowNumber} className={CARD}>
                  <p className="font-medium">{tenancy.tenant}</p>
                  <p className="mt-1 text-sm text-muted">{tenancyPeriod(tenancy.moveIn, tenancy.moveOut)}</p>
                  {outcome && <p className="mt-1 text-sm">{outcome}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
