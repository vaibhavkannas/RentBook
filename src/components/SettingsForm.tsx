"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import type { PortionConfig } from "@/lib/domain/types";
import { afterEdit, fieldProblem, plainMessage, plainProblem, problemAt, serverProblem, type FormProblem } from "@/lib/form-errors";
import { sendJson } from "@/lib/post-json";
import { sendFailureMessage, SETTINGS_NO_CONFIRMATION } from "@/lib/request-copy";
import { parseSettingsRows, type SettingsField, type SettingsRowInput } from "@/lib/settings-input";
import { SETTINGS_SAVED_TOAST } from "@/lib/toast-copy";
import { useFieldFocus } from "./useFieldFocus";

const toRow = (p: PortionConfig): SettingsRowInput => ({
  id: p.id,
  name: p.name,
  cycle: p.cycleLength === null ? "11" : String(p.cycleLength),
  never: p.cycleLength === null,
  hike: String(p.hikePercent),
});

type SaveBody = {
  ok: boolean;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  portions?: PortionConfig[];
};

/** The fields of a row, by the form's own names: the ones a message can be about. */
const FIELDS: SettingsField[] = ["name", "cycle", "hike"];

export default function SettingsForm({ portions }: { portions: PortionConfig[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(() => portions.map(toRow));
  const [busy, setBusy] = useState(false);
  // Only a problem is shown here. A save that went through is a toast. A problem about a field shows under it, in its row.
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const field = useFieldFocus(problem);

  /** Changes a row. Typing in a field clears what was said about that field; the tick box can make a cycle problem moot. */
  const update = (id: string, patch: Partial<SettingsRowInput>, edited: SettingsField) => {
    setProblem((current) => afterEdit(current, edited, id));
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  async function save() {
    const parsed = parseSettingsRows(rows);
    if (!parsed.ok) {
      setProblem(fieldProblem(parsed.message, parsed.field, FIELDS, parsed.rowId));
      return;
    }
    setBusy(true);
    setProblem(null);
    const sent = await sendJson<SaveBody>("/api/settings", { portions: parsed.portions }, { method: "PUT" });
    setBusy(false);
    if (sent.kind !== "answer") {
      setProblem(plainProblem(sendFailureMessage(sent, SETTINGS_NO_CONFIRMATION)));
    } else if (sent.body.ok) {
      // Show what was really stored, so the screen can never disagree with the Sheet.
      if (sent.body.portions) setRows(sent.body.portions.map(toRow));
      toast.show(SETTINGS_SAVED_TOAST);
      router.refresh();
    } else {
      setProblem(serverProblem(sent.body.error, FIELDS, parsed.portions.map((portion) => portion.id)));
    }
  }

  return (
    <form
      noValidate
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {/* While the settings are being saved no field can be edited. */}
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {rows.map((row) => (
          <Card as="fieldset" key={row.id} className="space-y-2">
            <legend className="sr-only">Settings for {row.name || row.id}</legend>
            <Field label="Portion name" error={problemAt(problem, "name", row.id)}>
              <Input
                ref={field("name", row.id)}
                value={row.name}
                onChange={(event) => update(row.id, { name: event.target.value }, "name")}
                autoCapitalize="words"
                autoComplete="off"
                required
                maxLength={60}
              />
            </Field>

            {/* One under the other, not side by side: the labels and the hint are too long for half a phone's width. */}
            <Field
              label="Payments per cycle"
              hint="After this many payments the count starts again at 1 and the hike is added."
              error={problemAt(problem, "cycle", row.id)}
            >
              <Input
                ref={field("cycle", row.id)}
                value={row.cycle}
                onChange={(event) => update(row.id, { cycle: event.target.value }, "cycle")}
                inputMode="numeric"
                autoComplete="off"
                disabled={row.never}
              />
            </Field>

            <Field label="Hike at each new cycle (%)" error={problemAt(problem, "hike", row.id)}>
              <Input
                ref={field("hike", row.id)}
                value={row.hike}
                onChange={(event) => update(row.id, { hike: event.target.value }, "hike")}
                inputMode="decimal"
                autoComplete="off"
              />
            </Field>

            <Checkbox
              label="Count never resets"
              checked={row.never}
              onChange={(event) => update(row.id, { never: event.target.checked }, "cycle")}
            />
          </Card>
        ))}
      </fieldset>

      {plainMessage(problem) && (
        <Notice tone="danger" role="alert">
          {plainMessage(problem)}
        </Notice>
      )}

      <Button type="submit" size="lg" className="w-full" pending={busy} pendingLabel="Saving…">
        Save settings
      </Button>
      <SlowHint busy={busy} />
    </form>
  );
}
