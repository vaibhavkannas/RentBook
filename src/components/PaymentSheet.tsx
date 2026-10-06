"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";

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
type ApiBody = { ok: boolean; error?: ApiError; logWritten?: boolean; logRow?: unknown[] };

async function postJson(url: string, method: string, payload: unknown): Promise<ApiBody | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as ApiBody;
  } catch {
    return null;
  }
}

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

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
  const [portionId, setPortionId] = useState(initialPortionId ?? cards[0].portionId);
  const card = cards.find((c) => c.portionId === portionId)!;

  const initialAmount =
    mode === "edit"
      ? card.entry?.amount
      : mode === "log"
        ? card.next?.suggestedAmount
        : undefined;
  const [amount, setAmount] = useState(initialAmount !== undefined ? String(initialAmount) : "");
  const [date, setDate] = useState(defaultDate);
  const [tenantName, setTenantName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ amount: number; tenant: string } | null>(null);
  const [pendingLog, setPendingLog] = useState<unknown[] | null>(null);

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
    setBusy(true);
    setError(null);
    const body = await postJson("/api/payments", "POST", {
      month: monthKey,
      portionId,
      amount: Number(amount.replace(/[,\s₹]/g, "")),
      dateReceived: date,
      newTenantName: mode === "new-tenant" ? tenantName : undefined,
      overwrite: overwrite || mode === "edit" ? true : undefined,
    });
    setBusy(false);

    if (!body) return setError(OFFLINE);
    if (body.ok) {
      router.refresh();
      if (body.logWritten === false) return setPendingLog(body.logRow ?? []);
      return onClose();
    }
    const failure = body.error!;
    if (failure.code === "conflict" && typeof failure.details?.existingAmount === "number") {
      return setConflict({
        amount: failure.details.existingAmount,
        tenant: String(failure.details.existingTenant ?? ""),
      });
    }
    setError(failure.message);
  }

  async function retryLog() {
    setBusy(true);
    const body = await postJson("/api/payments/log-retry", "POST", { row: pendingLog });
    setBusy(false);
    if (body?.ok && body.logWritten) return onClose();
    setError("The log entry still didn't save. The payment itself is safe in your Schedule.");
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
              {mode !== "new-tenant" ? ` · ${card.name}` : ""}
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

        {pendingLog ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              Saved to your Schedule, but the Payments Log entry didn&apos;t save.
            </p>
            {error && (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={retryLog}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
            >
              {busy ? "Retrying…" : "Retry log entry"}
            </button>
            <button type="button" onClick={onClose} className="min-h-11 w-full text-muted">
              Skip for now
            </button>
          </div>
        ) : conflict ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              {card.name} already has {formatRupees(conflict.amount)} recorded for {monthLabel}
              {conflict.tenant ? ` (${conflict.tenant})` : ""}. Replace it with{" "}
              {formatRupees(Number(amount.replace(/[,\s₹]/g, "")))}?
            </p>
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
              onClick={() => setConflict(null)}
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
                    className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
                  >
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
                    className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
                  />
                </label>
              </>
            )}

            {mode === "log" && card.next?.startsNewCycle && (
              <p className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success-ink">
                New cycle starts at payment 1. Amount is prefilled with the hike
                (was {formatRupees(card.next.previousAmount)}). Edit it if you agreed a different
                rent.
                <button
                  type="button"
                  onClick={() => setAmount(String(card.next!.previousAmount))}
                  className="ml-2 underline"
                >
                  Keep {formatRupees(card.next.previousAmount)}
                </button>
              </p>
            )}

            <label className="block text-sm">
              <span className="text-muted">Amount received (₹)</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                autoFocus={mode !== "new-tenant"}
                required
                className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-lg"
              />
            </label>

            <label className="block text-sm">
              <span className="text-muted">Date received</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
              />
            </label>

            {mode === "log" && card.next && (
              <p className="text-sm text-muted">
                {card.next.tenant} · Payment {card.next.count}
                {card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}. The count is set
                automatically.
              </p>
            )}
            {mode === "new-tenant" && (
              <p className="text-sm text-muted">Count restarts at 1 for a new tenant.</p>
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
