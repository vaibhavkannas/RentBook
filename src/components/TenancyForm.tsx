"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/post-json";
import {
  buildTenancyDraftRequest,
  editDraft,
  startDraft,
  type TenancyFormText,
  type TenancyTarget,
} from "@/lib/tenancy-input";
import { saveFailure, type TenancyApiBody } from "@/lib/tenancy-response";

type Props = {
  /** What this form saves. An edit carries the updated-at the page was rendered with. */
  target: TenancyTarget;
  /** The starting values. An edit form starts again from them every time it is opened. */
  initial: TenancyFormText;
};

const FIELD = "mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base";

/**
 * Add details (create) or Edit (a button that opens the form) for a tenancy. It only gathers text and
 * posts it: what is sent and what is wrong is decided by tenancy-input.ts and tenancy-response.ts.
 *
 * The form saves from its draft: the stale-screen token and the values were taken together when the form
 * was opened. The `target` and `initial` props can change later (router.refresh() delivers newer ones), but
 * they are only used when a form is opened, so a save never mixes a newer token with older values.
 */
export default function TenancyForm({ target, initial }: Props) {
  const router = useRouter();
  const editing = target.mode === "edit";
  const [open, setOpen] = useState(!editing);
  const [draft, setDraft] = useState(() => startDraft(target, initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** Shown while the edit form is closed after the page turned out to be out of date. */
  const [stale, setStale] = useState<string | null>(null);
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
      router.refresh();
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
      // The page behind the form is out of date. Load what is in the Sheet now. An edit form closes, so that
      // opening it again starts from the fresh page, and the message is shown while it is closed.
      router.refresh();
      if (editing) {
        setOpen(false);
        setStale(failure.message);
        return;
      }
    }
    setError(failure.message);
  }

  const statusText = saved ? (editing ? "Saved." : busy ? "Saved. Updating the page…" : null) : null;

  return (
    <>
      {/* Live regions stay on the page, so screen readers announce the text that appears in them. */}
      <div
        role="status"
        className={
          statusText
            ? editing
              ? "mt-3 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-ink"
              : "mt-3 text-sm text-muted"
            : undefined
        }
      >
        {statusText}
      </div>
      <div
        role="alert"
        className={stale ? "mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink" : undefined}
      >
        {stale}
      </div>

      {!open ? (
        <div className="mt-3">
          <button
            ref={editButton}
            type="button"
            aria-label="Edit tenancy details"
            onClick={() => {
              setDraft(startDraft(target, initial));
              setError(null);
              setSaved(false);
              setStale(null);
              setOpen(true);
            }}
            className="min-h-11 rounded-xl border border-control px-4 font-medium"
          >
            Edit
          </button>
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
          <label className="block text-sm">
            <span className="text-muted">Phone</span>
            <input
              type="tel"
              value={form.phone}
              onChange={(event) => set({ phone: event.target.value })}
              autoComplete="off"
              autoFocus={editing}
              maxLength={30}
              className={FIELD}
            />
          </label>

          <label className="block text-sm">
            <span className="text-muted">Move-in date</span>
            <input
              type="date"
              value={form.moveIn}
              onChange={(event) => set({ moveIn: event.target.value })}
              required
              className={FIELD}
            />
          </label>

          <label className="block text-sm">
            <span className="text-muted">Agreement end</span>
            <input
              type="date"
              value={form.agreementEnd}
              onChange={(event) => set({ agreementEnd: event.target.value })}
              className={FIELD}
            />
          </label>

          <label className="block text-sm">
            <span className="text-muted">Advance (₹)</span>
            <input
              value={form.advance}
              onChange={(event) => set({ advance: event.target.value })}
              inputMode="numeric"
              autoComplete="off"
              className={FIELD}
            />
          </label>

          <label className="block text-sm">
            <span className="text-muted">Advance date</span>
            <input
              type="date"
              value={form.advanceDate}
              onChange={(event) => set({ advanceDate: event.target.value })}
              className={FIELD}
            />
          </label>

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
            {busy ? "Saving…" : "Save details"}
          </button>
          {editing && (
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
          )}
        </form>
      )}
    </>
  );
}
