"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AddPortionSheet from "@/components/AddPortionSheet";
import PortionOrder from "@/components/PortionOrder";
import SwitchedOffPortions from "@/components/SwitchedOffPortions";
import SwitchOffSheet from "@/components/SwitchOffSheet";
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
import {
  onPortions,
  parseSettingsRows,
  reconcileRows,
  rowFromPortion,
  type SettingsField,
  type SettingsRowInput,
} from "@/lib/settings-input";
import { SETTINGS_SAVED_TOAST } from "@/lib/toast-copy";
import { useFieldFocus } from "./useFieldFocus";

type SaveBody = {
  ok: boolean;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  portions?: PortionConfig[];
};

/** The fields of a row, by the form's own names: the ones a message can be about. */
const FIELDS: SettingsField[] = ["name", "cycle", "hike"];

/** The dialog that is open over the form, if one is: adding a portion, or asking whether to switch one off. */
type OpenSheet = { kind: "add" } | { kind: "off"; portion: { id: string; name: string } };

/**
 * The portion settings: a card of fields for each portion that is on, with Switch off; Add a portion and Change order under the
 * form; and the portions that are off in their own section. `portions` are all of them. Changing which portions there are (add,
 * switch off or on, reorder) is done by the dialogs and the order editor, which send their own requests; the form keeps what
 * was typed in it and not yet saved, whatever they change.
 */
export default function SettingsForm({ portions }: { portions: PortionConfig[] }) {
  const router = useRouter();
  const toast = useToast();
  // The portions as the Sheet last said: what the page was drawn with, then what each change here answered.
  const [known, setKnown] = useState(portions);
  const [rows, setRows] = useState(() => onPortions(portions).map(rowFromPortion));
  const [pageHad, setPageHad] = useState(portions);
  if (portions !== pageHad) {
    // The page was brought up to date (after a change here, or on a visit): take its portions, and keep what was typed.
    setPageHad(portions);
    setKnown(portions);
    setRows((current) => reconcileRows(current, portions));
  }
  const [busy, setBusy] = useState(false);
  // Only a problem is shown here. A save that went through is a toast. A problem about a field shows under it, in its row.
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const field = useFieldFocus(problem);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [ordering, setOrdering] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const orderButton = useRef<HTMLButtonElement>(null);
  // A change that removes the button that opened its dialog leaves focus nowhere: it goes to Add a portion, under the form.
  const refocus = useRef(false);
  const wasOrdering = useRef(ordering);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    addButton.current?.focus();
  }, [known]);

  // Closing the order editor gives focus back to the button that opened it.
  useEffect(() => {
    if (wasOrdering.current && !ordering) orderButton.current?.focus();
    wasOrdering.current = ordering;
  }, [ordering]);

  /** The portions after a change made here: show them, and keep what was typed in the form. */
  const adopt = (next: PortionConfig[] | undefined) => {
    if (!next) return;
    setKnown(next);
    setRows((current) => reconcileRows(current, next));
  };

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
      if (sent.body.portions) {
        setKnown(sent.body.portions);
        setRows(onPortions(sent.body.portions).map(rowFromPortion));
      }
      toast.show(SETTINGS_SAVED_TOAST);
      router.refresh();
    } else {
      setProblem(serverProblem(sent.body.error, FIELDS, parsed.portions.map((portion) => portion.id)));
    }
  }

  if (ordering) {
    return (
      <PortionOrder
        portions={known}
        onCancel={() => setOrdering(false)}
        onSaved={(next) => {
          adopt(next);
          setOrdering(false);
        }}
      />
    );
  }

  return (
    <>
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
          {rows.map((row) => {
            // The name in the Sheet, not the one being typed: the button and the dialog name the portion as it is.
            const stored = known.find((portion) => portion.id === row.id)?.name ?? row.name;
            return (
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

                <div className="flex justify-end">
                  <Button
                    variant="dangerText"
                    aria-label={`Switch off ${stored}`}
                    onClick={() => setSheet({ kind: "off", portion: { id: row.id, name: stored } })}
                  >
                    Switch off
                  </Button>
                </div>
              </Card>
            );
          })}
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

      <div className="mt-3 space-y-3">
        <Button ref={addButton} variant="secondary" className="w-full" onClick={() => setSheet({ kind: "add" })}>
          Add a portion
        </Button>
        {known.length >= 2 && (
          <Button ref={orderButton} variant="secondary" className="w-full" onClick={() => setOrdering(true)}>
            Change order
          </Button>
        )}
      </div>

      <SwitchedOffPortions
        portions={known.filter((portion) => portion.inactive)}
        onSwitchedOn={(next) => {
          refocus.current = true;
          adopt(next);
        }}
      />

      {sheet?.kind === "add" && <AddPortionSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === "off" && (
        <SwitchOffSheet
          portion={sheet.portion}
          onClose={() => setSheet(null)}
          onSwitchedOff={(next) => {
            refocus.current = true;
            adopt(next);
            setSheet(null);
          }}
        />
      )}
    </>
  );
}
