"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { useToast } from "@/components/ui/Toast";
import type { AdvanceStatus } from "@/lib/domain/tenancy";
import { postJson } from "@/lib/post-json";
import { moveOutToastText } from "@/lib/toast-copy";
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
  /** The month the page was opened from. A move to another address keeps it, so the arrow back still leads there. */
  monthKey?: string | null;
};

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
export default function MoveOutForm({ target, initial, tenant, portionId, noticeShown = false, monthKey = null }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => startDraft(target, initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      applyPageMove(router, pageAfterSave(portionId, noticeShown, monthKey));
      toast.show(moveOutToastText(tenant));
      return;
    }
    setBusy(false);
    const failure = saveFailure(body);
    if (failure.refresh) {
      // The page behind the form is out of date. Open it again: it loads what is in the Sheet now and shows the
      // changed-just-now notice itself, so the notice does not go away when the page replaces this form. The form
      // closes, so that opening it again starts from the fresh page.
      applyPageMove(router, pageAfterConflict(portionId, noticeShown, monthKey));
      setOpen(false);
      return;
    }
    setError(failure.message);
  }

  return (
    <>
      {!open ? (
        <Button
          ref={openButton}
          variant="secondary"
          className="mt-3"
          onClick={() => {
            setDraft(startDraft(target, initial));
            setError(null);
            setOpen(true);
          }}
          aria-label={`Move out ${tenant}`}
        >
          Move out
        </Button>
      ) : (
        <form
          aria-label={`Move out ${tenant}`}
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {/* While the move-out is being saved no field can be edited. */}
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <Field label="Move-out date">
              <Input
                type="date"
                value={form.moveOut}
                onChange={(event) => set({ moveOut: event.target.value })}
                required
                autoFocus
              />
            </Field>

            {draft.seen.hasAdvance && (
              <Field label="What happened to the advance?" hint={MOVE_OUT_OUTCOME_HINT}>
                <Select
                  value={form.advanceStatus}
                  onChange={(event) => set({ advanceStatus: event.target.value as AdvanceStatus })}
                >
                  {OUTCOMES.map((outcome) => (
                    <option key={outcome.value} value={outcome.value}>
                      {outcome.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {/* One hint covers both amounts, so each field points at it. */}
            <div>
              <Field label="Refund (₹)">
                <Input
                  value={form.refund}
                  onChange={(event) => set({ refund: event.target.value })}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-describedby={rupeesHint}
                />
              </Field>
              <div className="mt-3">
                <Field label="Deductions (₹)">
                  <Input
                    value={form.deductions}
                    onChange={(event) => set({ deductions: event.target.value })}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-describedby={rupeesHint}
                  />
                </Field>
              </div>
              <p id={rupeesHint} className="mt-1 text-sm text-muted">
                {MOVE_OUT_RUPEES_HINT}
              </p>
            </div>

            <Field label="Notes">
              <TextArea
                value={form.notes}
                onChange={(event) => set({ notes: event.target.value })}
                rows={3}
                maxLength={500}
              />
            </Field>

            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}

            <Button type="submit" size="lg" className="w-full" pending={busy} pendingLabel="Saving…">
              Record move-out
            </Button>
          </fieldset>
          <Button
            variant="quiet"
            className="w-full"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </form>
      )}
    </>
  );
}
