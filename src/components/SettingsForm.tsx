"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { PortionConfig } from "@/lib/domain/types";
import { postJson, POST_TIMEOUT_MS } from "@/lib/post-json";
import { parseSettingsRows, type SettingsRowInput } from "@/lib/settings-input";

const toRow = (p: PortionConfig): SettingsRowInput => ({
  id: p.id,
  name: p.name,
  cycle: p.cycleLength === null ? "11" : String(p.cycleLength),
  never: p.cycleLength === null,
  hike: String(p.hikePercent),
});

type SaveBody = { ok: boolean; error?: { message: string }; portions?: PortionConfig[] };

export default function SettingsForm({ portions }: { portions: PortionConfig[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(() => portions.map(toRow));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const update = (id: string, patch: Partial<SettingsRowInput>) => {
    setMessage(null);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  async function save() {
    const parsed = parseSettingsRows(rows);
    if (!parsed.ok) {
      setMessage({ kind: "error", text: parsed.message });
      return;
    }
    setBusy(true);
    setMessage(null);
    const body = await postJson<SaveBody>("/api/settings", { portions: parsed.portions }, POST_TIMEOUT_MS, "PUT");
    setBusy(false);
    if (!body) {
      setMessage({ kind: "error", text: "Couldn't reach the server. Try again." });
    } else if (body.ok) {
      // Show what was really stored, so the screen can never disagree with the Sheet.
      if (body.portions) setRows(body.portions.map(toRow));
      setMessage({ kind: "ok", text: "Saved" });
      router.refresh();
    } else {
      setMessage({ kind: "error", text: body.error?.message ?? "Couldn't save settings." });
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
        <Card as="fieldset" key={row.id} className="space-y-2">
          <legend className="sr-only">Settings for {row.name || row.id}</legend>
          <Field label="Name">
            <Input
              value={row.name}
              onChange={(event) => update(row.id, { name: event.target.value })}
              required
              maxLength={60}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cycle length">
              <Input
                value={row.cycle}
                onChange={(event) => update(row.id, { cycle: event.target.value })}
                inputMode="numeric"
                disabled={row.never}
              />
            </Field>
            <Field label="Hike %">
              <Input
                value={row.hike}
                onChange={(event) => update(row.id, { hike: event.target.value })}
                inputMode="decimal"
              />
            </Field>
          </div>

          <Checkbox
            label="Count never resets"
            checked={row.never}
            onChange={(event) => update(row.id, { never: event.target.checked })}
          />
        </Card>
      ))}

      {message && (
        <Notice tone={message.kind === "ok" ? "success" : "danger"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </Notice>
      )}

      <Button type="submit" size="lg" className="w-full" pending={busy} pendingLabel="Saving…">
        Save settings
      </Button>
    </form>
  );
}
