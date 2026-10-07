"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TenancyFields } from "@/lib/domain/tenancy";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import {
  buildPaymentRequest,
  logRetryFailureMessage,
  paymentOutcome,
  TENANCY_NOT_SAVED_MESSAGE,
} from "@/lib/payment-request";
import { postJson } from "@/lib/post-json";
import { newTenantDetails, type NewTenantDetailsForm } from "@/lib/tenancy-input";

export type SheetMode = "log" | "edit" | "new-tenant";

type Props = {
  mode: SheetMode;
  monthKey: string;
  monthLabel: string;
  cards: PortionCard[];
  initialPortionId: string | null;
  defaultDate: string;
  onClose: () => void;
};

type ApiError = { code: string; message: string; details?: Record<string, unknown> };
type ApiBody = {
  ok: boolean;
  error?: ApiError;
  logWritten?: boolean;
  logRow?: unknown[];
  tenancyWritten?: boolean;
};

/** What the sheet still has to tell the person after the payment was saved. */
type Notice = { logRow: unknown[] | null; tenancyNotSaved: boolean };

const NO_CONFIRMATION =
  "Couldn't confirm that the save went through. Check your connection and refresh the page before trying again.";

export default function PaymentSheet({
  mode,
  monthKey,
  monthLabel,
  cards,
  initialPortionId,
  defaultDate,
  onClose,
}: Props) {
  const router = useRouter();
  // In the generic "New tenant" sheet the owner must choose the portion on purpose.
  const [portionId, setPortionId] = useState(initialPortionId ?? "");
  const card = cards.find((c) => c.portionId === portionId);

  // What the person saw when this sheet opened. An edit is checked against this, never against a
  // card that a background refresh has since changed.
  const [seenEntry] = useState(() => (mode === "edit" ? (card?.entry ?? undefined) : undefined));

  const initialAmount =
    mode === "edit"
      ? seenEntry?.amount
      : mode === "log"
        ? card?.next?.suggestedAmount
        : undefined;
  const [amount, setAmount] = useState(initialAmount !== undefined ? String(initialAmount) : "");
  const [date, setDate] = useState(defaultDate);
  const [tenantName, setTenantName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ amount: number; tenant: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The optional "Tenancy details" part of the New tenant sheet.
  const [details, setDetails] = useState<NewTenantDetailsForm>({
    moveIn: defaultDate,
    advance: "",
    advanceDate: "",
    agreementEnd: "",
    phone: "",
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const setDetail = (patch: Partial<NewTenantDetailsForm>) =>
    setDetails((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const title =
    mode === "new-tenant" ? "New tenant" : mode === "edit" ? "Edit amount" : "Log payment";

  async function submit(overwrite: boolean) {
    if (!card) return setError("Choose a portion first.");
    // The sheet decides whether tenancy details are sent: only when the person filled in or changed something.
    let tenancy: TenancyFields | undefined;
    if (mode === "new-tenant") {
      const parsed = newTenantDetails(details, defaultDate);
      if (!parsed.ok) {
        setDetailsOpen(true);
        return setError(parsed.message);
      }
      tenancy = parsed.tenancy;
    }
    const request = buildPaymentRequest({
      mode,
      monthKey,
      portionId,
      amount: Number(amount.replace(/[,\s₹]/g, "")),
      dateReceived: date,
      tenantName,
      confirmedReplace: overwrite,
      seenEntry,
      tenancy,
    });
    if (!request.ok) return setError(request.message);
    setBusy(true);
    setError(null);
    const body = await postJson<ApiBody>("/api/payments", request.body);
    setBusy(false);

    if (!body) return setError(NO_CONFIRMATION);
    if (body.ok) {
      router.refresh();
      const outcome = paymentOutcome(body);
      if (outcome.done) return onClose();
      return setNotice({ logRow: outcome.pendingLogRow, tenancyNotSaved: outcome.tenancyNotSaved });
    }
    const failure = body.error ?? { code: "unknown", message: "Something went wrong. Try again." };
    if (failure.code === "conflict" && typeof failure.details?.existingAmount === "number") {
      return setConflict({
        amount: failure.details.existingAmount,
        tenant: String(failure.details.existingTenant ?? ""),
      });
    }
    // Someone else changed this payment, so the screen behind this sheet is out of date.
    if (failure.code === "conflict") router.refresh();
    // The details are in the collapsed section, so open it when the server found something wrong in them.
    if (failure.code === "validation" && request.body.tenancy) setDetailsOpen(true);
    setError(failure.message);
  }

  async function retryLog() {
    if (!notice?.logRow) return;
    setBusy(true);
    setError(null);
    const body = await postJson<ApiBody>("/api/payments/log-retry", { row: notice.logRow });
    setBusy(false);
    if (body?.ok && body.logWritten) {
      // The log entry is saved now; the tenancy warning, if any, still has to be seen.
      if (notice.tenancyNotSaved) return setNotice({ logRow: null, tenancyNotSaved: true });
      return onClose();
    }
    setError(logRetryFailureMessage(body));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="max-h-dvh w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="sheet-title" className="text-lg font-semibold">
              {title}
            </h2>
            <p className="text-sm text-muted">
              {monthLabel}
              {mode !== "new-tenant" && card ? ` · ${card.name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="min-h-11 min-w-11 rounded-lg text-xl text-muted"
          >
            ×
          </button>
        </div>

        {/* On the page from the start, so screen readers announce the warning when its text appears. */}
        <div
          role="status"
          className={
            notice?.tenancyNotSaved
              ? "mt-4 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink"
              : undefined
          }
        >
          {notice?.tenancyNotSaved ? TENANCY_NOT_SAVED_MESSAGE : null}
        </div>

        {notice ? (
          <div className="mt-4 space-y-3">
            {notice.logRow && (
              <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
                Saved to your Schedule, but the Payments Log entry didn&apos;t save.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            )}
            {notice.logRow ? (
              <>
                <button
                  type="button"
                  onClick={retryLog}
                  disabled={busy}
                  className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
                >
                  {busy ? "Retrying…" : "Retry log entry"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="min-h-11 w-full text-muted"
                >
                  Skip for now
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onClose}
                autoFocus
                className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
              >
                Close
              </button>
            )}
          </div>
        ) : conflict ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              {card?.name ?? "This portion"} already has {formatRupees(conflict.amount)} recorded for{" "}
              {monthLabel}
              {conflict.tenant ? ` (${conflict.tenant})` : ""}. Replace it with{" "}
              {formatRupees(Number(amount.replace(/[,\s₹]/g, "")))}
              {mode === "new-tenant"
                ? ` and start ${tenantName.trim() || "the new tenant"} at payment 1`
                : ""}
              ?
            </p>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
            >
              {busy ? "Saving…" : "Replace amount"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConflict(null);
                setError(null);
              }}
              disabled={busy}
              className="min-h-11 w-full text-muted"
            >
              Go back
            </button>
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
          >
            {mode === "new-tenant" && (
              <>
                <label className="block text-sm">
                  <span className="text-muted">Portion</span>
                  <select
                    value={portionId}
                    onChange={(event) => setPortionId(event.target.value)}
                    required
                    className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
                  >
                    <option value="" disabled>
                      Choose a portion
                    </option>
                    {cards.map((c) => (
                      <option key={c.portionId} value={c.portionId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Tenant name</span>
                  <input
                    value={tenantName}
                    onChange={(event) => setTenantName(event.target.value)}
                    autoComplete="off"
                    autoFocus
                    required
                    maxLength={60}
                    className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
                  />
                </label>
              </>
            )}

            {mode === "log" && card?.next?.startsNewCycle && (
              <div className="space-y-2 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-ink">
                <p>
                  New cycle starts at payment 1. Amount is prefilled with the hike (was{" "}
                  {formatRupees(card.next.previousAmount)}). Edit it if you agreed a different rent.
                </p>
                <button
                  type="button"
                  onClick={() => setAmount(String(card.next!.previousAmount))}
                  className="min-h-11 w-full rounded-lg border border-current px-3 font-medium"
                >
                  Keep {formatRupees(card.next.previousAmount)}
                </button>
              </div>
            )}

            <label className="block text-sm">
              <span className="text-muted">Amount received (₹)</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                autoFocus={mode !== "new-tenant"}
                required
                className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-lg"
              />
            </label>

            <label className="block text-sm">
              <span className="text-muted">Date received</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
              />
            </label>

            {mode === "log" && card?.next && (
              <p className="text-sm text-muted">
                {card.next.tenant} · Payment {card.next.count}
                {card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}. The count is set
                automatically.
              </p>
            )}
            {mode === "new-tenant" && (
              <p className="text-sm text-muted">Count restarts at 1 for a new tenant.</p>
            )}

            {mode === "new-tenant" && (
              <details
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
                className="rounded-xl border border-line px-3"
              >
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
                  Tenancy details (optional)
                </summary>
                <div className="space-y-3 pb-3">
                  <label className="block text-sm">
                    <span className="text-muted">Move-in date</span>
                    <input
                      type="date"
                      value={details.moveIn}
                      onChange={(event) => setDetail({ moveIn: event.target.value })}
                      className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">Advance (₹)</span>
                    <input
                      value={details.advance}
                      onChange={(event) => setDetail({ advance: event.target.value })}
                      inputMode="numeric"
                      autoComplete="off"
                      className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">Advance date</span>
                    <input
                      type="date"
                      value={details.advanceDate}
                      onChange={(event) => setDetail({ advanceDate: event.target.value })}
                      className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">Agreement end</span>
                    <input
                      type="date"
                      value={details.agreementEnd}
                      onChange={(event) => setDetail({ agreementEnd: event.target.value })}
                      className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-muted">Phone</span>
                    <input
                      type="tel"
                      value={details.phone}
                      onChange={(event) => setDetail({ phone: event.target.value })}
                      autoComplete="off"
                      maxLength={30}
                      className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base"
                    />
                  </label>
                </div>
              </details>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
            >
              {busy ? "Saving…" : "Save to sheet"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
