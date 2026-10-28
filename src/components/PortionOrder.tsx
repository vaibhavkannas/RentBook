"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { LiveNotice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import type { PortionConfig } from "@/lib/domain/types";
import { moveInOrder, orderPositionText, sameOrder, type PortionsApiBody } from "@/lib/portion-requests";
import { sendJson } from "@/lib/post-json";
import { apiErrorMessage, PORTION_NO_CONFIRMATION, sendFailureMessage } from "@/lib/request-copy";
import { ORDER_SAVED_TOAST } from "@/lib/toast-copy";

type Props = {
  /** Every portion, the ones switched off too, in the order the Sheet has them. */
  portions: PortionConfig[];
  onCancel: () => void;
  /** The order is saved. `portions` are all the portions as the Sheet now has them. */
  onSaved: (portions: PortionConfig[] | undefined) => void;
};

/** A chevron, drawn inline: the glyphs ▲ and ▼ look different on every phone. */
function Chevron({ down }: { down?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d={down ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} />
    </svg>
  );
}

/**
 * Change order: a list of every portion with a Move up and a Move down button each. The moves happen here, on the screen, and are
 * sent once, with Save order: nothing in the Sheet changes until then. It takes the place of the form while it is open.
 */
export default function PortionOrder({ portions, onCancel, onSaved }: Props) {
  const router = useRouter();
  const toast = useToast();
  const byId = new Map(portions.map((portion) => [portion.id, portion]));
  const [ids, setIds] = useState(() => portions.map((portion) => portion.id));
  // Where the portion just moved now is, for a screen reader: the buttons move with it, so what was pressed is not where it was.
  const [position, setPosition] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A button that is disabled cannot keep focus, and a list that is reordered moves the buttons: focus follows the move.
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterMove = useRef<string | null>(null);

  useEffect(() => {
    if (focusAfterMove.current === null) return;
    buttons.current.get(focusAfterMove.current)?.focus();
    focusAfterMove.current = null;
  }, [ids]);

  function move(index: number, delta: -1 | 1) {
    const next = moveInOrder(ids, index, delta);
    if (sameOrder(next, ids)) return;
    const id = ids[index];
    const at = index + delta;
    // Focus stays on the button that was pressed, unless the portion has reached the end that button points to.
    const atEnd = delta < 0 ? at === 0 : at === next.length - 1;
    focusAfterMove.current = `${id}:${atEnd ? (delta < 0 ? "down" : "up") : delta < 0 ? "up" : "down"}`;
    setIds(next);
    setPosition(orderPositionText(byId.get(id)?.name ?? "", at, next.length));
    setProblem(null);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const sent = await sendJson<PortionsApiBody>("/api/portions/order", { ids }, { method: "PUT" });
    setBusy(false);
    if (sent.kind !== "answer") return setProblem(sendFailureMessage(sent, PORTION_NO_CONFIRMATION));
    if (!sent.body.ok) {
      if (sent.body.error?.code === "conflict") router.refresh();
      return setProblem(apiErrorMessage(sent.body.error));
    }
    toast.show(ORDER_SAVED_TOAST);
    router.refresh();
    onSaved(sent.body.portions);
  }

  const button = (id: string, way: "up" | "down") => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(`${id}:${way}`, node);
    else buttons.current.delete(`${id}:${way}`);
  };

  return (
    <section aria-labelledby="order-heading" className="mt-3">
      <h2 id="order-heading" className="font-medium">
        Change order
      </h2>
      <p className="mt-1 text-sm text-muted">
        Portions show on the month screen in this order. Your Schedule&apos;s columns do not move.
      </p>
      <ol className="mt-3 space-y-2">
        {ids.map((id, index) => {
          const portion = byId.get(id);
          if (!portion) return null;
          return (
            <Card as="li" key={id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 break-words font-medium">{portion.name}</span>
              {portion.inactive && <Pill tone="neutral">Off</Pill>}
              <IconButton ref={button(id, "up")} label={`Move ${portion.name} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}>
                <Chevron />
              </IconButton>
              <IconButton
                ref={button(id, "down")}
                label={`Move ${portion.name} down`}
                disabled={busy || index === ids.length - 1}
                onClick={() => move(index, 1)}
              >
                <Chevron down />
              </IconButton>
            </Card>
          );
        })}
      </ol>
      <LiveNotice tone="success" className="mt-3">
        {position}
      </LiveNotice>
      <LiveNotice tone="danger" className="mt-3">
        {problem}
      </LiveNotice>
      <div className="mt-4 space-y-3">
        <Button size="lg" className="w-full" onClick={() => void save()} pending={busy} pendingLabel="Saving…">
          Save order
        </Button>
        <Button variant="secondary" className="w-full" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <SlowHint busy={busy} />
      </div>
    </section>
  );
}
