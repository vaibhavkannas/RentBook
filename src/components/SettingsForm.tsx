"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PortionConfig } from "@/lib/domain/types";

type Row = { id: string; name: string; cycle: string; never: boolean; hike: string };

const toRow = (p: PortionConfig): Row => ({
  id: p.id,
  name: p.name,
  cycle: p.cycleLength === null ? "11" : String(p.cycleLength),
  never: p.cycleLength === null,
  hike: String(p.hikePercent),
});

export default function SettingsForm({ portions }: { portions: PortionConfig[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(() => portions.map(toRow));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portions: rows.map((row) => ({
            id: row.id,
            name: row.name,
            cycleLength: row.never ? null : Number(row.cycle),
            hikePercent: Number(row.hike),
          })),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (body.ok) {
        setMessage({ kind: "ok", text: "Saved" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: body.error?.message ?? "Couldn't save settings." });
      }
    } catch {
      setMessage({ kind: "error", text: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {rows.map((row) => (
        <fieldset key={row.id} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <label className="block text-sm">
            <span className="text-muted">Name</span>
            <input
              value={row.name}
              onChange={(event) => update(row.id, { name: event.target.value })}
              required
              maxLength={60}
              className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted">Cycle length</span>
              <input
                value={row.cycle}
                onChange={(event) => update(row.id, { cycle: event.target.value })}
                inputMode="numeric"
                disabled={row.never}
                className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 disabled:opacity-50"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Hike %</span>
              <input
                value={row.hike}
                onChange={(event) => update(row.id, { hike: event.target.value })}
                inputMode="decimal"
                className="mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3"
              />
            </label>
          </div>

          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={row.never}
              onChange={(event) => update(row.id, { never: event.target.checked })}
              className="size-5"
            />
            Count never resets
          </label>
        </fieldset>
      ))}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${
            message.kind === "ok" ? "bg-success-bg text-success-ink" : "bg-danger-bg text-danger-ink"
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
      >
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
