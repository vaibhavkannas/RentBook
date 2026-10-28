"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import { BRAND } from "@/lib/brand";
import { afterEdit, fieldProblem, plainMessage, plainProblem, problemAt, serverProblem, type FormProblem } from "@/lib/form-errors";
import {
  ADD_PORTION_FIELDS,
  addedPortionText,
  buildAddPortionRequest,
  type AddedPortionResult,
  type AddPortionApiBody,
} from "@/lib/portion-requests";
import { sendJson } from "@/lib/post-json";
import { PORTION_NO_CONFIRMATION, sendFailureMessage } from "@/lib/request-copy";
import { portionAddedToastText } from "@/lib/toast-copy";
import { useFieldFocus } from "./useFieldFocus";

const FIELDS: readonly string[] = ADD_PORTION_FIELDS;

/** What the sheet says once the portion is in the Sheet: where its columns are, what to add to a Total formula by hand, and Done. */
export function AddedPortion({ result, onDone }: { result: AddedPortionResult; onDone: () => void }) {
  return (
    <div className="mt-4 space-y-3">
      <Notice tone="success" role="status">
        {addedPortionText(result.portion.name, result.columns)}
      </Notice>
      {result.totalNote && <Notice tone="warn">{result.totalNote}</Notice>}
      <Button size="lg" className="w-full" onClick={onDone} autoFocus>
        Done
      </Button>
    </div>
  );
}

/**
 * "Add a portion": the name, the payments per cycle and the hike. It only gathers text and posts it: portion-requests.ts decides what
 * is wrong before anything is sent, and the Sheet decides the rest (which columns, which row). When the portion is added the sheet
 * says where its columns are and waits for Done; every way out then shows the toast and brings the page behind up to date.
 */
export default function AddPortionSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [cycle, setCycle] = useState("11");
  const [never, setNever] = useState(false);
  const [hike, setHike] = useState("5");
  const [busy, setBusy] = useState(false);
  // What is wrong: a message beside the field it is about, or in the sheet's own box when it is about the sheet.
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [added, setAdded] = useState<AddedPortionResult | null>(null);
  // A request went to the server, so the page behind may be out of date whatever came back.
  const sentOnce = useRef(false);
  const field = useFieldFocus(problem);

  /** Typing in a field clears what was said about it. */
  const clear = (edited: string) => setProblem((current) => afterEdit(current, edited));

  /** Every way out (Done, the x, Escape). */
  function finish() {
    if (added) toast.show(portionAddedToastText(added.portion.name));
    if (sentOnce.current) router.refresh();
    onClose();
  }

  async function submit() {
    if (busy) return;
    const request = buildAddPortionRequest({ name, cycle, never, hike });
    if (!request.ok) return setProblem(fieldProblem(request.message, request.field, FIELDS));
    setBusy(true);
    setProblem(null);
    sentOnce.current = true;
    const sent = await sendJson<AddPortionApiBody>("/api/portions", request.body);
    setBusy(false);
    if (sent.kind !== "answer") return setProblem(plainProblem(sendFailureMessage(sent, PORTION_NO_CONFIRMATION)));
    const body = sent.body;
    if (!body.ok) return setProblem(serverProblem(body.error, FIELDS));
    // An answer that says it worked and has no portion in it is not one to trust.
    if (!body.portion || !body.columns) return setProblem(plainProblem(PORTION_NO_CONFIRMATION));
    setAdded({ portion: body.portion, columns: body.columns, totalNote: body.totalNote ?? null });
  }

  return (
    <Sheet labelledBy="add-portion-title" onClose={finish} canClose={!busy} closeOnBackdrop={false}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="add-portion-title" className="text-lg font-semibold">
          Add a portion
        </h2>
        <IconButton label="Close" tone="muted" onClick={finish} disabled={busy}>
          ×
        </IconButton>
      </div>

      {added ? (
        <AddedPortion result={added} onDone={finish} />
      ) : (
        <form
          noValidate
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* While the portion is being added no field can be edited. */}
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            <Field label="Portion name" error={problemAt(problem, "name")}>
              <Input
                ref={field("name")}
                value={name}
                onChange={(event) => {
                  clear("name");
                  setName(event.target.value);
                }}
                autoCapitalize="words"
                autoComplete="off"
                enterKeyHint="next"
                autoFocus
                required
                maxLength={60}
              />
            </Field>

            <Field
              label="Payments per cycle"
              hint="After this many payments the count starts again at 1 and the hike is added."
              error={problemAt(problem, "cycle")}
            >
              <Input
                ref={field("cycle")}
                value={cycle}
                onChange={(event) => {
                  clear("cycle");
                  setCycle(event.target.value);
                }}
                inputMode="numeric"
                autoComplete="off"
                disabled={never}
              />
            </Field>

            <Checkbox
              label="Count never resets"
              checked={never}
              onChange={(event) => {
                clear("cycle");
                setNever(event.target.checked);
              }}
            />

            <Field label="Hike at each new cycle (%)" error={problemAt(problem, "hike")}>
              <Input
                ref={field("hike")}
                value={hike}
                onChange={(event) => {
                  clear("hike");
                  setHike(event.target.value);
                }}
                inputMode="decimal"
                autoComplete="off"
              />
            </Field>
          </fieldset>

          <p className="text-sm text-muted">
            {BRAND.name} adds three columns for this portion (Tenant, Count and Amount) to the right of your Schedule, and a row to the
            Settings tab. Nothing else in your Sheet changes.
          </p>

          {plainMessage(problem) && (
            <Notice tone="danger" role="alert">
              {plainMessage(problem)}
            </Notice>
          )}

          <Button type="submit" size="lg" className="w-full" pending={busy} pendingLabel="Adding…">
            Add portion
          </Button>
          <SlowHint busy={busy} />
        </form>
      )}
    </Sheet>
  );
}
