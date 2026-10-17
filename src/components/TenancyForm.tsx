"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, TextArea } from "@/components/ui/Field";
import { LiveNotice, Notice } from "@/components/ui/Notice";
import { postJson } from "@/lib/post-json";
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
  type TenancyApiBody,
} from "@/lib/tenancy-response";

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
  const editing = target.mode === "edit";
  const [open, setOpen] = useState(!editing);
  const [draft, setDraft] = useState(() => startDraft(target, initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Closing the edit form gives focus back to the Edit button.
  useEffect(() => {
    if (wasOpen.current && !open) editButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const set = (patch: Partial<TenancyFormText>) => {
    setError(null);
    setDraft((current) => editDraft(current, patch));
  };
  const form = draft.form;

  async function save() {
    if (busy) return;
    const request = buildTenancyDraftRequest(draft);
    if (!request.ok) {
      setError(request.message);
      return;
    }
    setBusy(true);
    setError(null);
    const body = await postJson<TenancyApiBody>("/api/tenancies", request.body);
    if (body?.ok) {
      applyPageMove(router, pageAfterSave(target.portionId, noticeShown, monthKey));
      setSaved(true);
      // An edit form closes. A create form stays disabled until the refreshed page replaces it.
      if (editing) {
        setBusy(false);
        setOpen(false);
      }
      return;
    }
    setBusy(false);
    const failure = saveFailure(body);
    if (failure.refresh) {
      // The page behind the form is out of date. Open it again: it loads what is in the Sheet now and shows the
      // changed-just-now notice itself, so the notice does not go away when the page replaces this form. An edit
      // form closes, so that opening it again starts from the fresh page.
      applyPageMove(router, pageAfterConflict(target.portionId, noticeShown, monthKey));
      if (editing) setOpen(false);
      return;
    }
    setError(failure.message);
  }

  const statusText = saved ? (editing ? "Saved." : busy ? "Saved. Updating the page…" : null) : null;

  return (
    <>
      {/* Live regions stay on the page, so screen readers announce the text that appears in them. */}
      {editing ? (
        <LiveNotice tone="success" className="mt-3">
          {statusText}
        </LiveNotice>
      ) : (
        <div role="status" className={statusText ? "mt-3 text-sm text-muted" : undefined}>
          {statusText}
        </div>
      )}
      {!open ? (
        <div className="mt-3">
          <Button
            ref={editButton}
            variant="secondary"
            aria-label="Edit tenancy details"
            onClick={() => {
              setDraft(startDraft(target, initial));
              setError(null);
              setSaved(false);
              setOpen(true);
            }}
          >
            Edit
          </Button>
        </div>
      ) : (
        <form
          aria-label={editing ? "Edit tenancy details" : "Add tenancy details"}
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="Phone">
            <Input
              type="tel"
              value={form.phone}
              onChange={(event) => set({ phone: event.target.value })}
              autoComplete="off"
              autoFocus={editing}
              maxLength={30}
            />
          </Field>

          <Field label="Move-in date" hint={editing ? undefined : "Change this if the tenant moved in earlier."}>
            <Input
              type="date"
              value={form.moveIn}
              onChange={(event) => set({ moveIn: event.target.value })}
              required
            />
          </Field>

          <Field label="Agreement end">
            <Input
              type="date"
              value={form.agreementEnd}
              onChange={(event) => set({ agreementEnd: event.target.value })}
            />
          </Field>

          <Field label="Advance (₹)">
            <Input
              value={form.advance}
              onChange={(event) => set({ advance: event.target.value })}
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>

          <Field label="Advance date">
            <Input
              type="date"
              value={form.advanceDate}
              onChange={(event) => set({ advanceDate: event.target.value })}
            />
          </Field>

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
            Save details
          </Button>
          {editing && (
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
          )}
        </form>
      )}
    </>
  );
}
