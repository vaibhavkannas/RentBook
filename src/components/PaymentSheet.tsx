"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { LiveNotice, Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { HIKE_ROUNDING_ALLOWANCE, roundedChoices } from "@/lib/domain/rent-rules";
import type { TenancyFields } from "@/lib/domain/tenancy";
import type { PortionCard, PortionEntry } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import {
  amountFromText,
  buildPaymentRequest,
  existingEntryFrom,
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
  retryToken?: string;
  tenancyWritten?: boolean;
};

/** What the sheet still has to tell the person after the payment was saved. */
type AfterSave = { retryToken: string | null; tenancyNotSaved: boolean };

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
  // The payment a duplicate warning named: the Replace it offers is checked against this entry.
  const [conflict, setConflict] = useState<PortionEntry | null>(null);
  const [notice, setNotice] = useState<AfterSave | null>(null);
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
      amount: amountFromText(amount),
      dateReceived: date,
      tenantName,
      confirmedReplace: overwrite,
      seenEntry: seenEntry ?? (overwrite ? (conflict ?? undefined) : undefined),
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
      return setNotice({ retryToken: outcome.retryToken, tenancyNotSaved: outcome.tenancyNotSaved });
    }
    const failure = body.error ?? { code: "unknown", message: "Something went wrong. Try again." };
    const duplicate = failure.code === "conflict" ? existingEntryFrom(failure.details) : null;
    if (duplicate) return setConflict(duplicate);
    // Someone else changed this payment, so the screen behind this sheet is out of date.
    if (failure.code === "conflict") router.refresh();
    // The details are in the collapsed section, so open it when the server found something wrong in them.
    if (failure.code === "validation" && request.body.tenancy) setDetailsOpen(true);
    setError(failure.message);
  }

  async function retryLog() {
    if (notice?.retryToken == null) return;
    setBusy(true);
    setError(null);
    const body = await postJson<ApiBody>("/api/payments/log-retry", { token: notice.retryToken });
    setBusy(false);
    if (body?.ok && body.logWritten) {
      // The log entry is saved now; the tenancy warning, if any, still has to be seen.
      if (notice.tenancyNotSaved) return setNotice({ retryToken: null, tenancyNotSaved: true });
      return onClose();
    }
    setError(logRetryFailureMessage(body));
  }

  return (
    <Sheet labelledBy="sheet-title" onClose={onClose} canClose={!busy} closeOnBackdrop={false}>
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
        <IconButton label="Close" tone="muted" onClick={onClose} disabled={busy}>
          ×
        </IconButton>
      </div>

      {/* On the page from the start, so screen readers announce the warning when its text appears. */}
      <LiveNotice tone="warn" className="mt-4">
        {notice?.tenancyNotSaved ? TENANCY_NOT_SAVED_MESSAGE : null}
      </LiveNotice>

      {notice ? (
        <div className="mt-4 space-y-3">
          {notice.retryToken !== null && (
            <Notice tone="warn">Saved to your Schedule, but the Payments Log entry didn&apos;t save.</Notice>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger-ink">
              {error}
            </p>
          )}
          {notice.retryToken !== null ? (
            <>
              <Button
                size="lg"
                className="w-full"
                onClick={retryLog}
                pending={busy}
                pendingLabel="Retrying…"
              >
                Retry log entry
              </Button>
              <Button variant="quiet" className="w-full" onClick={onClose} disabled={busy}>
                Skip for now
              </Button>
            </>
          ) : (
            <Button size="lg" className="w-full" onClick={onClose} autoFocus>
              Close
            </Button>
          )}
        </div>
      ) : conflict ? (
        <div className="mt-4 space-y-3">
          <Notice tone="warn">
            {card?.name ?? "This portion"} already has {formatRupees(conflict.amount)} recorded for {monthLabel}
            {conflict.tenant ? ` (${conflict.tenant})` : ""}. Replace it with {formatRupees(amountFromText(amount))}
            {mode === "new-tenant" ? ` and start ${tenantName.trim() || "the new tenant"} at payment 1` : ""}?
          </Notice>
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          <Button
            size="lg"
            className="w-full"
            onClick={() => submit(true)}
            pending={busy}
            pendingLabel="Saving…"
          >
            Replace amount
          </Button>
          <Button
            variant="quiet"
            className="w-full"
            onClick={() => {
              setConflict(null);
              setError(null);
            }}
            disabled={busy}
          >
            Go back
          </Button>
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
              <Field label="Portion">
                <Select value={portionId} onChange={(event) => setPortionId(event.target.value)} required>
                  <option value="" disabled>
                    Choose a portion
                  </option>
                  {cards.map((c) => (
                    <option key={c.portionId} value={c.portionId}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tenant name">
                <Input
                  value={tenantName}
                  onChange={(event) => setTenantName(event.target.value)}
                  autoComplete="off"
                  autoFocus
                  required
                  maxLength={60}
                />
              </Field>
            </>
          )}

          {mode === "log" && card?.next?.startsNewCycle && (
            <Notice tone="success" as="div" className="space-y-2">
              <p>
                New cycle starts at payment 1. Amount is prefilled with the hike (was{" "}
                {formatRupees(card.next.previousAmount)}). Edit it if you agreed a different rent. A rent within{" "}
                {formatRupees(HIKE_ROUNDING_ALLOWANCE)} of the hike counts as rounded, not as extra or short.
              </p>
              {roundedChoices(card.next.suggestedAmount).length > 0 && (
                <div className="flex gap-2">
                  {roundedChoices(card.next.suggestedAmount).map((value) => (
                    <Button
                      key={value}
                      variant="outline"
                      className="flex-1"
                      onClick={() => setAmount(String(value))}
                    >
                      Round to {formatRupees(value)}
                    </Button>
                  ))}
                </div>
              )}
              <Button variant="outline" className="w-full" onClick={() => setAmount(String(card.next!.previousAmount))}>
                Keep {formatRupees(card.next.previousAmount)}
              </Button>
            </Notice>
          )}

          <Field label="Amount received (₹)">
            <Input
              large
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
              autoFocus={mode !== "new-tenant"}
              required
            />
          </Field>

          <Field label="Date received">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </Field>

          {mode === "log" && card?.next && (
            <p className="text-sm text-muted">
              {card.next.tenant} · Payment {card.next.count}
              {card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}. The count is set automatically.
            </p>
          )}
          {mode === "new-tenant" && <p className="text-sm text-muted">Count restarts at 1 for a new tenant.</p>}

          {mode === "new-tenant" && (
            <details
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
              className="group rounded-xl border border-control px-3"
            >
              {/* flex takes away the browser's own arrow, so the chevron is drawn here; it turns down when open. */}
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Tenancy details (optional)
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none"
                >
                  <path d="M7 4l6 6-6 6" />
                </svg>
              </summary>
              <div className="space-y-3 pb-3">
                <Field label="Move-in date">
                  <Input
                    type="date"
                    value={details.moveIn}
                    onChange={(event) => setDetail({ moveIn: event.target.value })}
                  />
                </Field>
                <Field label="Advance (₹)">
                  <Input
                    value={details.advance}
                    onChange={(event) => setDetail({ advance: event.target.value })}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Advance date">
                  <Input
                    type="date"
                    value={details.advanceDate}
                    onChange={(event) => setDetail({ advanceDate: event.target.value })}
                  />
                </Field>
                <Field label="Agreement end">
                  <Input
                    type="date"
                    value={details.agreementEnd}
                    onChange={(event) => setDetail({ agreementEnd: event.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={details.phone}
                    onChange={(event) => setDetail({ phone: event.target.value })}
                    autoComplete="off"
                    maxLength={30}
                  />
                </Field>
              </div>
            </details>
          )}

          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}

          <Button type="submit" size="lg" className="w-full" pending={busy} pendingLabel="Saving…">
            Save to sheet
          </Button>
        </form>
      )}
    </Sheet>
  );
}
