"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, TextArea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import type { AdvanceStatus } from "@/lib/domain/tenancy";
import { afterEdit, fieldProblem, plainMessage, plainProblem, problemAt, type FormProblem } from "@/lib/form-errors";
import { sendJson } from "@/lib/post-json";
import { sendFailureMessage } from "@/lib/request-copy";
import { moveOutToastText } from "@/lib/toast-copy";
import {
  buildAnyMoveOutRequest,
  editDraft,
  startDraft,
  type MoveOutFormText,
  type MoveOutTarget,
  type RecordMoveOutTarget,
} from "@/lib/tenancy-input";
import {
  applyPageMove,
  pageAfterConflict,
  pageAfterSave,
  saveFailure,
  TENANCY_NO_CONFIRMATION,
  type TenancyApiBody,
} from "@/lib/tenancy-response";
import { MOVE_OUT_OUTCOME_HINT, MOVE_OUT_RUPEES_HINT } from "@/lib/tenancy-view";
import { useFieldFocus } from "./useFieldFocus";

/** The fields a message can be about, by the form's own names: a tenant with no details on file has only the day. */
const FIELDS = ["moveOut", "refund", "deductions"];
const RECORD_FIELDS = ["moveOut"];

type Props = {
  /** The tenancy being closed, as the page was rendered, or the tenant with no details on file whose move-out is recorded. */
  target: MoveOutTarget | RecordMoveOutTarget;
  /** The starting values. The form starts again from them every time it is opened. */
  initial: MoveOutFormText;
  /** Only used in the button's name, and in the toast. */
  tenant: string;
  /** The portion's name, for the toast that says it is vacant. */
  portionName: string;
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
 * refund, the deductions and notes. For a tenant with no details on file (a `target` with kind "record") it is only the
 * date and notes. It only gathers text and posts it: tenancy-input.ts and tenancy-response.ts decide the rest.
 *
 * The form saves from its draft: the stale-screen token, the notes baseline and the values were taken together
 * when the form was opened. The `target` and `initial` props can change later (router.refresh() delivers newer
 * ones), but they are only used when the form is opened, so a save never mixes a newer token with older values.
 */
export default function MoveOutForm({
  target,
  initial,
  tenant,
  portionName,
  portionId,
  noticeShown = false,
  monthKey = null,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => startDraft(target, initial));
  const [busy, setBusy] = useState(false);
  // What is wrong: a message under the field it is about, or in the form's own box when it is about the form.
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const field = useFieldFocus(problem);
  const rupeesHint = useId();
  const openButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Closing the form gives focus back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !open) openButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  /** Changes a field. Typing in a field clears what was said about it. */
  const set = (patch: Partial<MoveOutFormText>, edited: keyof MoveOutFormText) => {
    setProblem((current) => afterEdit(current, edited));
    setDraft((current) => editDraft(current, patch));
  };
  const form = draft.form;
  // The details on file have an outcome for the advance, a refund and deductions; a tenant with none has only the day.
  const onFile = "kind" in draft.seen ? null : draft.seen;
  const fields = onFile ? FIELDS : RECORD_FIELDS;

  async function save() {
    if (busy) return;
    const request = buildAnyMoveOutRequest(draft);
    if (!request.ok) {
      setProblem(fieldProblem(request.message, request.field, fields));
      return;
    }
    setBusy(true);
    setProblem(null);
    const sent = await sendJson<TenancyApiBody>("/api/tenancies/move-out", request.body);
    if (sent.kind === "answer" && sent.body.ok) {
      // The refreshed page shows the tenancy as a past one and replaces this form. Until then it stays disabled.
      applyPageMove(router, pageAfterSave(portionId, noticeShown, monthKey));
      toast.show(moveOutToastText(tenant, portionName, request.body.moveOut));
      return;
    }
    setBusy(false);
    if (sent.kind !== "answer") {
      setProblem(plainProblem(sendFailureMessage(sent, TENANCY_NO_CONFIRMATION)));
      return;
    }
    const failure = saveFailure(sent.body, fields);
    if (failure.refresh) {
      // The page behind the form is out of date. Open it again: it loads what is in the Sheet now and shows the
      // changed-just-now notice itself, so the notice does not go away when the page replaces this form. The form
      // closes, so that opening it again starts from the fresh page.
      applyPageMove(router, pageAfterConflict(portionId, noticeShown, monthKey));
      setOpen(false);
      return;
    }
    setProblem(failure.problem);
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
            setProblem(null);
            setOpen(true);
          }}
          aria-label={`Move out ${tenant}`}
        >
          Move out
        </Button>
      ) : (
        <form
          noValidate
          aria-label={`Move out ${tenant}`}
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {/* While the move-out is being saved no field can be edited. */}
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <Field label="Move-out date" error={problemAt(problem, "moveOut")}>
              <Input
                ref={field("moveOut")}
                type="date"
                value={form.moveOut}
                onChange={(event) => set({ moveOut: event.target.value }, "moveOut")}
                required
                autoFocus
              />
            </Field>

            {onFile?.hasAdvance && (
              <Field label="What happened to the advance?" hint={MOVE_OUT_OUTCOME_HINT}>
                <Select
                  value={form.advanceStatus}
                  onChange={(event) => set({ advanceStatus: event.target.value as AdvanceStatus }, "advanceStatus")}
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
            {onFile && (
              <div>
                <Field label="Refund (₹)" error={problemAt(problem, "refund")}>
                  <Input
                    ref={field("refund")}
                    value={form.refund}
                    onChange={(event) => set({ refund: event.target.value }, "refund")}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-describedby={rupeesHint}
                  />
                </Field>
                <div className="mt-3">
                  <Field label="Deductions (₹)" error={problemAt(problem, "deductions")}>
                    <Input
                      ref={field("deductions")}
                      value={form.deductions}
                      onChange={(event) => set({ deductions: event.target.value }, "deductions")}
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
            )}

            <Field label="Notes">
              <TextArea
                value={form.notes}
                onChange={(event) => set({ notes: event.target.value }, "notes")}
                autoCapitalize="sentences"
                rows={3}
                maxLength={500}
              />
            </Field>

            {plainMessage(problem) && (
              <Notice tone="danger" role="alert">
                {plainMessage(problem)}
              </Notice>
            )}

            <Button type="submit" size="lg" className="w-full" pending={busy} pendingLabel="Saving…">
              Record move-out
            </Button>
            <SlowHint busy={busy} />
          </fieldset>
          <Button
            variant="quiet"
            className="w-full"
            onClick={() => {
              setOpen(false);
              setProblem(null);
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
