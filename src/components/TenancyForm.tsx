"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/post-json";
import { buildTenancyRequest, type TenancyFormText, type TenancyTarget } from "@/lib/tenancy-input";
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
 * posts it: what is sent and what is wrong is decided by buildTenancyRequest and saveFailure.
 */
export default function TenancyForm({ target, initial }: Props) {
  const router = useRouter();
  const editing = target.mode === "edit";
  const [open, setOpen] = useState(!editing);
  const [form, setForm] = useState(initial);
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
    setForm((current) => ({ ...current, ...patch }));
  };

  async function save() {
    if (busy) return;
    const request = buildTenancyRequest(target, form);
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
    // The page behind the form is out of date: show what is in the Sheet now, and keep what was typed.
    if (failure.refresh) router.refresh();
    setError(failure.message);
  }

  if (!open) {
    return (
      <div className="mt-3">
        {saved && (
          <p role="status" className="mb-2 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-ink">
            Saved.
          </p>
        )}
        <button
          ref={editButton}
          type="button"
          aria-label="Edit tenancy details"
          onClick={() => {
            setForm(initial);
            setError(null);
            setSaved(false);
            setOpen(true);
          }}
          className="min-h-11 rounded-xl border border-control px-4 font-medium"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
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
          maxLength={20}
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
      {busy && !error && saved && (
        <p role="status" className="text-sm text-muted">
          Saved. Updating the page…
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
  );
}
