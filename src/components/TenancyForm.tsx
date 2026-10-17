"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, TextArea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import { afterEdit, fieldProblem, plainMessage, plainProblem, problemAt, type FormProblem } from "@/lib/form-errors";
import { sendJson } from "@/lib/post-json";
import { sendFailureMessage } from "@/lib/request-copy";
import { DETAILS_SAVED_TOAST } from "@/lib/toast-copy";
import {
  buildTenancyDraftRequest,
  editDraft,
  startDraft,
  type TenancyFormText,
  type TenancyTarget,
} from "@/lib/tenancy-input";
import {
  applyPageMove,
  pageAfterConflict,
  pageAfterSave,
  saveFailure,
  TENANCY_NO_CONFIRMATION,
  type TenancyApiBody,
} from "@/lib/tenancy-response";
import { useFieldFocus } from "./useFieldFocus";

/** The fields a message can be about, by the form's own names. */
const FIELDS = ["phone", "moveIn", "agreementEnd", "advance", "advanceDate", "notes"];

type Props = {
  /** What this form saves. An edit carries the updated-at the page was rendered with. */
  target: TenancyTarget;
  /** The starting values. An edit form starts again from them every time it is opened. */
  initial: TenancyFormText;
  /** The page is showing the changed-just-now notice, so a save that goes through has to take it away. */
  noticeShown?: boolean;
  /** The month the page was opened from. A move to another address keeps it, so the arrow back still leads there. */
  monthKey?: string | null;
};

/**
 * Add details (create) or Edit (a button that opens the form) for a tenancy. It only gathers text and
 * posts it: what is sent and what is wrong is decided by tenancy-input.ts and tenancy-response.ts.
 *
 * The form saves from its draft: the stale-screen token and the values were taken together when the form
 * was opened. The `target` and `initial` props can change later (router.refresh() delivers newer ones), but
 * they are only used when a form is opened, so a save never mixes a newer token with older values.
 */
export default function TenancyForm({ target, initial, noticeShown = false, monthKey = null }: Props) {
  const router = useRouter();
  const toast = useToast();
  const editing = target.mode === "edit";
  const [open, setOpen] = useState(!editing);
  const [draft, setDraft] = useState(() => startDraft(target, initial));
  const [busy, setBusy] = useState(false);
  // What is wrong: a message under the field it is about, or in the form's own box when it is about the form.
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const field = useFieldFocus(problem);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Closing the edit form gives focus back to the Edit button.
  useEffect(() => {
    if (wasOpen.current && !open) editButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  /** Changes a field. Typing in a field clears what was said about it. */
  const set = (patch: Partial<TenancyFormText>, edited: keyof TenancyFormText) => {
    setProblem((current) => afterEdit(current, edited));
    setDraft((current) => editDraft(current, patch));
  };
  const form = draft.form;

  async function save() {
    if (busy) return;
    const request = buildTenancyDraftRequest(draft);
    if (!request.ok) {
      setProblem(fieldProblem(request.message, request.field, FIELDS));
      return;
    }
    setBusy(true);
    setProblem(null);
    const sent = await sendJson<TenancyApiBody>("/api/tenancies", request.body);
    if (sent.kind === "answer" && sent.body.ok) {
      applyPageMove(router, pageAfterSave(target.portionId, noticeShown, monthKey));
      toast.show(DETAILS_SAVED_TOAST);
      setSaved(true);
      // An edit form closes. A create form stays disabled until the refreshed page replaces it.
      if (editing) {
        setBusy(false);
        setOpen(false);
      }
      return;
    }
    setBusy(false);
    if (sent.kind !== "answer") {
      setProblem(plainProblem(sendFailureMessage(sent, TENANCY_NO_CONFIRMATION)));
      return;
    }
    const failure = saveFailure(sent.body, FIELDS);
    if (failure.refresh) {
      // The page behind the form is out of date. Open it again: it loads what is in the Sheet now and shows the
      // changed-just-now notice itself, so the notice does not go away when the page replaces this form. An edit
      // form closes, so that opening it again starts from the fresh page.
      applyPageMove(router, pageAfterConflict(target.portionId, noticeShown, monthKey));
      if (editing) setOpen(false);
      return;
    }
    setProblem(failure.problem);
  }

  // The create form stays disabled until the refreshed page replaces it, and says so. An edit form closes, and the toast
  // says it was saved.
  const statusText = saved && !editing && busy ? "Saved. Updating the page…" : null;

  return (
    <>
      {/* The live region stays on the page, so screen readers announce the text that appears in it. */}
      <div role="status" className={statusText ? "mt-3 text-sm text-muted" : undefined}>
        {statusText}
      </div>
      {!open ? (
        <div className="mt-3">
          <Button
            ref={editButton}
            variant="secondary"
            aria-label="Edit tenancy details"
            onClick={() => {
              setDraft(startDraft(target, initial));
              setProblem(null);
              setSaved(false);
              setOpen(true);
            }}
          >
            Edit
          </Button>
        </div>
      ) : (
        <form
          noValidate
          aria-label={editing ? "Edit tenancy details" : "Add tenancy details"}
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {/* While the details are being saved no field can be edited. */}
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <Field label="Phone" error={problemAt(problem, "phone")}>
              <Input
                ref={field("phone")}
                type="tel"
                value={form.phone}
                onChange={(event) => set({ phone: event.target.value }, "phone")}
                autoComplete="off"
                autoFocus={editing}
                maxLength={30}
              />
            </Field>

            <Field
              label="Move-in date"
              hint={editing ? undefined : "Change this if the tenant moved in earlier."}
              error={problemAt(problem, "moveIn")}
            >
              <Input
                ref={field("moveIn")}
                type="date"
                value={form.moveIn}
                onChange={(event) => set({ moveIn: event.target.value }, "moveIn")}
                required
              />
            </Field>

            <Field label="Agreement end" error={problemAt(problem, "agreementEnd")}>
              <Input
                ref={field("agreementEnd")}
                type="date"
                value={form.agreementEnd}
                onChange={(event) => set({ agreementEnd: event.target.value }, "agreementEnd")}
              />
            </Field>

            <Field label="Advance (₹)" error={problemAt(problem, "advance")}>
              <Input
                ref={field("advance")}
                value={form.advance}
                onChange={(event) => set({ advance: event.target.value }, "advance")}
                inputMode="numeric"
                autoComplete="off"
              />
            </Field>

            <Field label="Advance date" error={problemAt(problem, "advanceDate")}>
              <Input
                ref={field("advanceDate")}
                type="date"
                value={form.advanceDate}
                onChange={(event) => set({ advanceDate: event.target.value }, "advanceDate")}
              />
            </Field>

            <Field label="Notes" error={problemAt(problem, "notes")}>
              <TextArea
                ref={field("notes")}
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
              Save details
            </Button>
            <SlowHint busy={busy} />
          </fieldset>
          {editing && (
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
          )}
        </form>
      )}
    </>
  );
}
