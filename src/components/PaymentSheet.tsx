"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { LiveNotice, Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import { farFromSuggestion, roundedChoices } from "@/lib/domain/rent-rules";
import type { TenancyFields } from "@/lib/domain/tenancy";
import type { PortionCard, PortionEntry } from "@/lib/domain/types";
import {
  afterEdit,
  fieldProblem,
  isDetailField,
  NEW_TENANT_DETAIL_FIELDS,
  plainMessage,
  plainProblem,
  problemAt,
  serverProblem,
  type FormProblem,
} from "@/lib/form-errors";
import { formatRupees } from "@/lib/format";
import { isVacantCard } from "@/lib/month-summary";
import {
  amountFromText,
  buildPaymentRequest,
  LOG_RETRY_UNCONFIRMED_MESSAGE,
  logRetryFailureMessage,
  paymentOutcome,
  TENANCY_NOT_SAVED_MESSAGE,
} from "@/lib/payment-request";
import { HISTORY_NOT_SAVED, settleHistory } from "@/lib/history-retry";
import type { Change, Writes } from "@/lib/optimistic";
import { sendJson } from "@/lib/post-json";
import { sendFailureMessage } from "@/lib/request-copy";
import { paymentOutcomeAway } from "@/lib/write-outcome";
import { applyStep, classifyPayment, type PaymentAnswer, type WriteHooks } from "@/lib/write-flow";
import { exitToastText, logEntryState, paymentToasts, type LogEntryState, type PaymentToasts } from "@/lib/toast-copy";
import { newTenantDetails, type NewTenantDetailsForm } from "@/lib/tenancy-input";
import { useFieldFocus } from "./useFieldFocus";
import { publishAway } from "./publishAway";
import { useParking } from "./useParking";

/** Said when a second change to a portion is started while its first is still being saved. */
const BUSY_MESSAGE = "A change to this portion is still being saved. Wait a moment, then try again.";

export type SheetMode = "log" | "edit" | "new-tenant";

type Props = {
  mode: SheetMode;
  monthKey: string;
  monthLabel: string;
  cards: PortionCard[];
  initialPortionId: string | null;
  defaultDate: string;
  onClose: () => void;
  /**
   * What the month screen changes a card with while the request is on its way. With it, Save to Sheet changes the card at once
   * and the sheet goes out of sight until the answer; without it the sheet waits for the answer, as it always did.
   */
  writes?: Writes;
  /** Offers Undo on the toast of a payment that was logged. Opens the screen's own undo sheet, so the undo's guard stays. */
  onUndo?: (portionId: string) => void;
};

type ApiError = { code: string; message: string; details?: Record<string, unknown> };
type ApiBody = {
  ok: boolean;
  error?: ApiError;
  logWritten?: boolean;
  retryToken?: string;
  tenancyWritten?: boolean;
  historyWritten?: boolean;
  historyRetryToken?: string;
};

/** What the sheet still has to tell the person after the payment was saved. */
type AfterSave = { retryToken: string | null; tenancyNotSaved: boolean };

/** The fields a message can be about, by the sheet's own names: the ones logging and editing have, and those the New tenant sheet adds. */
const LOG_FIELDS = ["amount", "date"];
const NEW_TENANT_FIELDS = ["portion", "tenantName", ...LOG_FIELDS, ...NEW_TENANT_DETAIL_FIELDS];

export default function PaymentSheet({
  mode,
  monthKey,
  monthLabel,
  cards,
  initialPortionId,
  defaultDate,
  onClose,
  writes,
  onUndo,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const parking = useParking(onClose);
  // A sheet that was let go (another sheet was opened, or the person moved on) is gone when its request is answered: what the
  // answer means is then told outside the sheet (see publishAway).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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
  // What is wrong: a message beside the field it is about, or in the sheet's own box when it is about the sheet.
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const field = useFieldFocus(problem);
  const known = mode === "new-tenant" ? NEW_TENANT_FIELDS : LOG_FIELDS;
  // The payment a duplicate warning named: the Replace it offers is checked against this entry.
  const [conflict, setConflict] = useState<PortionEntry | null>(null);
  /** The amount typed for the first payment of a new cycle that is far from the suggestion, waiting for a yes. */
  const [farAmount, setFarAmount] = useState<number | null>(null);
  const [notice, setNotice] = useState<AfterSave | null>(null);
  // What the toast will say once the sheet closes. The payment is saved, but a notice (the log entry or the tenancy
  // details did not save) keeps the sheet open, and the toast waits for the person to be done with it. It has two texts:
  // while the Payments Log entry is still unsaved, "logged" would not be true.
  const [doneToasts, setDoneToasts] = useState<PaymentToasts | null>(null);
  /** The last retry of the Payments Log entry got no answer, so the entry may have saved after all. */
  const [retryUnanswered, setRetryUnanswered] = useState(false);
  // The optional "Tenancy details" part of the New tenant sheet.
  const [details, setDetails] = useState<NewTenantDetailsForm>({
    moveIn: defaultDate,
    advance: "",
    advanceDate: "",
    agreementEnd: "",
    phone: "",
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const setDetail = (name: keyof NewTenantDetailsForm, value: string) => {
    clear(name);
    setDetails((current) => ({ ...current, [name]: value }));
  };
  /** Typing in a field clears what was said about it. */
  const clear = (name: string) => setProblem((current) => afterEdit(current, name));
  /** Shows a problem; the details are in a box that starts closed, so a problem inside it opens it. */
  const show = (next: FormProblem) => {
    if (isDetailField(next.field)) setDetailsOpen(true);
    setProblem(next);
  };

  const title =
    mode === "new-tenant" ? "New tenant" : mode === "edit" ? "Edit amount" : "Log payment";

  /** Closes the sheet, and shows the toast of a payment that was saved while the sheet waited on a notice. */
  function finishWith(logEntry: LogEntryState) {
    if (doneToasts) toast.show(exitToastText(doneToasts, logEntry));
    onClose();
  }
  /**
   * Every way out (Close, Skip for now, the x, Escape): the log entry is saved unless the notice is still offering to retry it,
   * and then it is not confirmed if the last retry got no answer, because that retry may have gone through.
   */
  const finish = () => finishWith(logEntryState(notice?.retryToken != null, retryUnanswered));

  async function submit(overwrite: boolean, confirmedFar = false) {
    if (!card) return show(fieldProblem("Choose a portion first.", "portion", known));
    // The sheet decides whether tenancy details are sent: only when the person filled in or changed something.
    let tenancy: TenancyFields | undefined;
    let detailsProblem: FormProblem | null = null;
    if (mode === "new-tenant") {
      const parsed = newTenantDetails(details, defaultDate);
      if (parsed.ok) tenancy = parsed.tenancy;
      else detailsProblem = fieldProblem(parsed.message, parsed.field, known);
    }
    const request = buildPaymentRequest({
      mode,
      monthKey,
      portionId,
      amountText: amount,
      dateReceived: date,
      tenantName,
      confirmedReplace: overwrite,
      seenEntry: seenEntry ?? (overwrite ? (conflict ?? undefined) : undefined),
      tenancy,
    });
    // The first thing wrong, in the order the fields are on the screen: the tenant's name and the amount, then the details box.
    if (!request.ok) return show(fieldProblem(request.message, request.field, known));
    if (detailsProblem) return show(detailsProblem);
    // The first payment of a new cycle is the rent of the whole cycle: a far amount needs a yes first.
    if (mode === "log" && card.next?.startsNewCycle && !overwrite && !confirmedFar && farFromSuggestion(request.body.amount, card.next.suggestedAmount)) {
      return setFarAmount(request.body.amount);
    }
    // A second change to a portion whose change is still on its way is not started.
    if (writes?.busy(monthKey, portionId)) return show(plainProblem(BUSY_MESSAGE));
    // The card changes at once, and the sheet steps aside until the request is answered. A failure puts the card back.
    const change: Change | null = writes
      ? mode === "new-tenant"
        ? { kind: "new-tenant", portionId, tenant: tenantName.trim(), amount: request.body.amount }
        : { kind: mode, portionId, amount: request.body.amount }
      : null;
    const hooks: WriteHooks = {
      begin: () => change && writes?.begin(monthKey, change),
      settle: () => writes?.settle(monthKey, portionId),
      rollback: () => change && writes?.rollback(monthKey, portionId),
      refresh: () => router.refresh(),
    };
    setBusy(true);
    setProblem(null);
    if (change) {
      hooks.begin();
      parking.park();
    }
    const sent = await sendJson<PaymentAnswer>("/api/payments", request.body);
    setBusy(false);

    const step = classifyPayment(sent);
    // Without a card to put back, the screen is only told what it always was: a saved payment, or a payment someone else changed.
    if (change || step.kind === "saved" || step.kind === "stale") applyStep(step, hooks);

    if (!alive.current && step.kind !== "saved") {
      return publishAway(paymentOutcomeAway(step, { portion: card.name, monthLabel }), toast, () => {});
    }
    if (step.kind === "failed") {
      show(plainProblem(step.message));
      if (!change) return;
      // The card is back as it was. The sheet is still there with what was typed: Try again brings it back. When the request may
      // have saved, the words say to check first, so what is offered is a look at the Sheet, not a second try.
      toast.show(step.message, step.refresh ? { label: "Check", onPress: hooks.refresh } : { label: "Try again", onPress: parking.reopen });
      return parking.offerRetry();
    }
    if (step.kind === "saved") {
      const body = step.body;
      const toasts = paymentToasts({
        mode,
        replaced: overwrite,
        portion: card.name,
        tenant: tenantName.trim(),
        amount: request.body.amount,
        monthLabel,
      });
      // A new tenant's details are saved with the payment. Their history is settled in the background, one automatic retry at
      // most, and is nothing to wait for or to show unless it cannot be added.
      void settleHistory(body).then((ok) => ok || toast.show(HISTORY_NOT_SAVED));
      const outcome = paymentOutcome(body);
      if (outcome.done) {
        toast.show(toasts.saved, mode === "log" && onUndo ? { label: "Undo", onPress: () => onUndo(portionId) } : undefined);
        return onClose();
      }
      if (!alive.current) return publishAway(paymentOutcomeAway(step, { portion: card.name, monthLabel }), toast, () => {});
      setDoneToasts(toasts);
      setNotice({ retryToken: outcome.retryToken, tenancyNotSaved: outcome.tenancyNotSaved });
      return parking.reopen();
    }
    parking.reopen();
    if (step.kind === "duplicate") return setConflict(step.entry);
    // The details are in the collapsed section, so open it when the server found something wrong in them.
    if (step.error?.code === "validation" && request.body.tenancy) setDetailsOpen(true);
    show(serverProblem(step.error, known));
  }

  async function retryLog() {
    if (notice?.retryToken == null) return;
    setBusy(true);
    setProblem(null);
    const sent = await sendJson<ApiBody>("/api/payments/log-retry", { token: notice.retryToken });
    setBusy(false);
    const body = sent.kind === "answer" ? sent.body : null;
    if (body?.ok && body.logWritten) {
      // The log entry is saved now; the tenancy warning, if any, still has to be seen.
      if (notice.tenancyNotSaved) return setNotice({ retryToken: null, tenancyNotSaved: true });
      return finishWith("saved");
    }
    setRetryUnanswered(body === null);
    setProblem(
      plainProblem(
        sent.kind === "answer" ? logRetryFailureMessage(body) : sendFailureMessage(sent, LOG_RETRY_UNCONFIRMED_MESSAGE),
      ),
    );
  }

  // While the request is on its way the card behind shows the change, and the sheet is out of sight.
  if (!parking.visible) return null;

  return (
    <Sheet labelledBy="sheet-title" onClose={finish} canClose={!busy} closeOnBackdrop={false}>
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
        <IconButton label="Close" tone="muted" onClick={finish} disabled={busy}>
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
          {problem && (
            <p role="alert" className="text-sm text-danger-ink">
              {problem.message}
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
              <Button variant="quiet" className="w-full" onClick={finish} disabled={busy}>
                Skip for now
              </Button>
            </>
          ) : (
            <Button size="lg" className="w-full" onClick={finish} autoFocus>
              Close
            </Button>
          )}
          <SlowHint busy={busy} />
        </div>
      ) : farAmount !== null && card?.next ? (
        <div className="mt-4 space-y-3">
          <Notice tone="warn">
            This will become the rent for the whole cycle: {formatRupees(farAmount)} (suggested {formatRupees(card.next.suggestedAmount)}).
            Every later month in the cycle will suggest {formatRupees(farAmount)} and the next hike is worked from it.
          </Notice>
          {problem && (
            <Notice tone="danger" role="alert">
              {problem.message}
            </Notice>
          )}
          <Button size="lg" className="w-full" onClick={() => submit(false, true)} pending={busy} pendingLabel="Saving…">
            Yes, use {formatRupees(farAmount)}
          </Button>
          <Button
            variant="quiet"
            className="w-full"
            onClick={() => {
              setFarAmount(null);
              setProblem(null);
            }}
            disabled={busy}
          >
            Change amount
          </Button>
          <SlowHint busy={busy} />
        </div>
      ) : conflict ? (
        <div className="mt-4 space-y-3">
          <Notice tone="warn">
            {card?.name ?? "This portion"} already has {formatRupees(conflict.amount)} recorded for {monthLabel}
            {conflict.tenant ? ` (${conflict.tenant})` : ""}. Replace it with {formatRupees(amountFromText(amount))}
            {mode === "new-tenant" ? ` and start ${tenantName.trim() || "the new tenant"} at payment 1` : ""}?
          </Notice>
          {problem && (
            <Notice tone="danger" role="alert">
              {problem.message}
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
              setProblem(null);
            }}
            disabled={busy}
          >
            Go back
          </Button>
          <SlowHint busy={busy} />
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          {/* While the payment is being saved no field can be edited. */}
          <fieldset disabled={busy} className="mt-4 min-w-0 space-y-3">
            {mode === "new-tenant" && (
              <>
                <Field label="Portion" error={problemAt(problem, "portion")}>
                  <Select
                    ref={field("portion")}
                    value={portionId}
                    onChange={(event) => {
                      clear("portion");
                      setPortionId(event.target.value);
                    }}
                    required
                  >
                    <option value="" disabled>
                      Choose a portion
                    </option>
                    {/* A switched-off portion has a card only for its history; it takes no new tenant. */}
                    {cards.filter((c) => !c.inactive).map((c) => (
                      <option key={c.portionId} value={c.portionId}>
                        {isVacantCard(c) ? `${c.name} (vacant)` : c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tenant name" error={problemAt(problem, "tenantName")}>
                  <Input
                    ref={field("tenantName")}
                    value={tenantName}
                    onChange={(event) => {
                      clear("tenantName");
                      setTenantName(event.target.value);
                    }}
                    autoComplete="off"
                    autoCapitalize="words"
                    spellCheck={false}
                    enterKeyHint="next"
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
                  {formatRupees(card.next.previousAmount)}). Edit it if you agreed a different rent. Whatever you log here becomes the
                  rent for this cycle, rounded or not.
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

            <Field label="Amount received (₹)" error={problemAt(problem, "amount")}>
              <Input
                ref={field("amount")}
                large
                value={amount}
                onChange={(event) => {
                  clear("amount");
                  setAmount(event.target.value);
                }}
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                autoFocus={mode !== "new-tenant"}
                required
              />
            </Field>

            <Field label="Date received" error={problemAt(problem, "date")}>
              <Input
                ref={field("date")}
                type="date"
                value={date}
                onChange={(event) => {
                  clear("date");
                  setDate(event.target.value);
                }}
                required
              />
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
                  <Field label="Move-in date" error={problemAt(problem, "moveIn")}>
                    <Input
                      ref={field("moveIn")}
                      type="date"
                      value={details.moveIn}
                      onChange={(event) => setDetail("moveIn", event.target.value)}
                    />
                  </Field>
                  <Field label="Advance (₹)" error={problemAt(problem, "advance")}>
                    <Input
                      ref={field("advance")}
                      value={details.advance}
                      onChange={(event) => setDetail("advance", event.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Advance date" error={problemAt(problem, "advanceDate")}>
                    <Input
                      ref={field("advanceDate")}
                      type="date"
                      value={details.advanceDate}
                      onChange={(event) => setDetail("advanceDate", event.target.value)}
                    />
                  </Field>
                  <Field label="Agreement end" error={problemAt(problem, "agreementEnd")}>
                    <Input
                      ref={field("agreementEnd")}
                      type="date"
                      value={details.agreementEnd}
                      onChange={(event) => setDetail("agreementEnd", event.target.value)}
                    />
                  </Field>
                  <Field label="Phone" error={problemAt(problem, "phone")}>
                    <Input
                      ref={field("phone")}
                      type="tel"
                      value={details.phone}
                      onChange={(event) => setDetail("phone", event.target.value)}
                      autoComplete="off"
                      maxLength={30}
                    />
                  </Field>
                </div>
              </details>
            )}

            {plainMessage(problem) && (
              <Notice tone="danger" role="alert">
                {plainMessage(problem)}
              </Notice>
            )}

            <Button type="submit" size="lg" className="w-full" pending={busy} pendingLabel="Saving…">
              Save to Sheet
            </Button>
            <SlowHint busy={busy} />
          </fieldset>
        </form>
      )}
    </Sheet>
  );
}
