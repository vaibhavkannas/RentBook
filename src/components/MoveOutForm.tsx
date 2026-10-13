"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { AdvanceStatus } from "@/lib/domain/tenancy";
import { postJson } from "@/lib/post-json";
import {
  buildMoveOutDraftRequest,
  editDraft,
  startDraft,
  type MoveOutFormText,
  type MoveOutTarget,
} from "@/lib/tenancy-input";
import {
  applyPageMove,
  pageAfterConflict,
  pageAfterSave,
  saveFailure,
  type TenancyApiBody,
} from "@/lib/tenancy-response";
import { MOVE_OUT_OUTCOME_HINT, MOVE_OUT_RUPEES_HINT } from "@/lib/tenancy-view";

type Props = {
  /** The tenancy being closed, as the page was rendered. */
  target: MoveOutTarget;
  /** The starting values. The form starts again from them every time it is opened. */
  initial: MoveOutFormText;
  /** Only used in the button's name. */
  tenant: string;
  /** The portion whose page this is: where the form goes after a save or a conflict. */
  portionId: string;
  /** The page is showing the changed-just-now notice, so a save that goes through has to take it away. */
  noticeShown?: boolean;
};

const FIELD = "mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base";

const OUTCOMES: Array<{ value: AdvanceStatus; label: string }> = [
  { value: "Refunded", label: "Refunded" },
  { value: "Adjusted", label: "Adjusted" },
  { value: "Held", label: "Held" },
];

/**
 * "Move out" (a button that opens the form) for a current tenancy: the date, what happened to the advance, the
 * refund, the deductions and notes. It only gathers text and posts it: tenancy-input.ts and tenancy-response.ts decide the rest.
 *
 * The form saves from its draft: the stale-screen token, the notes baseline and the values were taken together
 * when the form was opened. The `target` and `initial` props can change later (router.refresh() delivers newer
 * ones), but they are only used when the form is opened, so a save never mixes a newer token with older values.
 */
export default function MoveOutForm({ target, initial, tenant, portionId, noticeShown = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => startDraft(target, initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcomeHint = useId();
  const rupeesHint = useId();
  const openButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Closing the form gives focus back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !open) openButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const set = (patch: Partial<MoveOutFormText>) => {
    setError(null);
    setDraft((current) => editDraft(current, patch));
  };
  const form = draft.form;

  async function save() {
    if (busy) return;
    const request = buildMoveOutDraftRequest(draft);
    if (!request.ok) {
      setError(request.message);
      return;
    }
    setBusy(true);
    setError(null);
    const body = await postJson<TenancyApiBody>("/api/tenancies/move-out", request.body);
    if (body?.ok) {
      // The refreshed page shows the tenancy as a past one and replaces this form. Until then it stays disabled.
      applyPageMove(router, pageAfterSave(portionId, noticeShown));
      return;
    }
    setBusy(false);
    const failure = saveFailure(body);
    if (failure.refresh) {
      // The page behind the form is out of date. Open it again: it loads what is in the Sheet now and shows the
      // changed-just-now notice itself, so the notice does not go away when the page replaces this form. The form
      // closes, so that opening it again starts from the fresh page.
      applyPageMove(router, pageAfterConflict(portionId, noticeShown));
      setOpen(false);
      return;
    }
    setError(failure.message);
  }

  return (
    <>
      {!open ? (
        <button
          ref={openButton}
          type="button"
          onClick={() => {
            setDraft(startDraft(target, initial));
            setError(null);
            setOpen(true);
          }}
          aria-label={`Move out ${tenant}`}
          className="mt-3 min-h-11 rounded-xl border border-control px-4 font-medium"
        >
          Move out
        </button>
      ) : (
        <form
          aria-label={`Move out ${tenant}`}
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block text-sm">
            <span className="text-muted">Move-out date</span>
            <input
              type="date"
              value={form.moveOut}
              onChange={(event) => set({ moveOut: event.target.value })}
              required
              autoFocus
              className={FIELD}
            />
          </label>

          {draft.seen.hasAdvance && (
            <div>
              <label className="block text-sm">
                <span className="text-muted">What happened to the advance?</span>
                <select
                  value={form.advanceStatus}
                  onChange={(event) => set({ advanceStatus: event.target.value as AdvanceStatus })}
                  aria-describedby={outcomeHint}
                  className={FIELD}
                >
                  {OUTCOMES.map((outcome) => (
                    <option key={outcome.value} value={outcome.value}>
                      {outcome.label}
                    </option>
                  ))}
                </select>
              </label>
              <p id={outcomeHint} className="mt-1 text-sm text-muted">
                {MOVE_OUT_OUTCOME_HINT}
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm">
              <span className="text-muted">Refund (₹)</span>
              <input
                value={form.refund}
                onChange={(event) => set({ refund: event.target.value })}
                inputMode="numeric"
                autoComplete="off"
                aria-describedby={rupeesHint}
                className={FIELD}
              />
            </label>

            <label className="mt-3 block text-sm">
              <span className="text-muted">Deductions (₹)</span>
              <input
                value={form.deductions}
                onChange={(event) => set({ deductions: event.target.value })}
                inputMode="numeric"
                autoComplete="off"
                aria-describedby={rupeesHint}
                className={FIELD}
              />
            </label>
            <p id={rupeesHint} className="mt-1 text-sm text-muted">
              {MOVE_OUT_RUPEES_HINT}
            </p>
          </div>

          <label className="block text-sm">
            <span className="text-muted">Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => set({ notes: event.target.value })}
              rows={3}
              maxLength={500}
              className="mt-1 w-full rounded-xl border border-control bg-surface px-3 py-2 text-base"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Record move-out"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            disabled={busy}
            className="min-h-11 w-full text-muted"
          >
            Cancel
          </button>
        </form>
      )}
    </>
  );
}
