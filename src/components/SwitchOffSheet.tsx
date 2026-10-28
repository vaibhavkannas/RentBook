"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LiveNotice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { SlowHint } from "@/components/ui/SlowHint";
import { useToast } from "@/components/ui/Toast";
import type { PortionConfig } from "@/lib/domain/types";
import { SWITCH_OFF_RULE, type PortionsApiBody } from "@/lib/portion-requests";
import { sendJson } from "@/lib/post-json";
import { apiErrorMessage, PORTION_NO_CONFIRMATION, sendFailureMessage } from "@/lib/request-copy";
import { portionSwitchedOffToastText } from "@/lib/toast-copy";

type Props = {
  portion: { id: string; name: string };
  onClose: () => void;
  /** The portion is off. `portions` are all the portions as the Sheet now has them. */
  onSwitchedOff: (portions: PortionConfig[] | undefined) => void;
};

/**
 * "Switch off {name}?": what leaves the screens and what stays, and the two buttons. Keep it on is the safe choice and takes focus.
 * The Sheet may refuse (the portion still has a tenant, or it is the last one on): its words show here, in the dialog.
 */
export default function SwitchOffSheet({ portion, onClose, onSwitchedOff }: Props) {
  const router = useRouter();
  const toast = useToast();
  const keep = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function switchOff() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const sent = await sendJson<PortionsApiBody>("/api/portions/active", { id: portion.id, active: false }, { method: "PUT" });
    setBusy(false);
    if (sent.kind !== "answer") return setProblem(sendFailureMessage(sent, PORTION_NO_CONFIRMATION));
    if (!sent.body.ok) {
      // The Settings tab changed under this screen: the page behind it is out of date.
      if (sent.body.error?.code === "conflict") router.refresh();
      return setProblem(apiErrorMessage(sent.body.error));
    }
    toast.show(portionSwitchedOffToastText(portion.name));
    router.refresh();
    onSwitchedOff(sent.body.portions);
  }

  return (
    <Sheet
      labelledBy="switch-off-title"
      describedBy="switch-off-text"
      onClose={onClose}
      canClose={!busy}
      closeOnBackdrop={false}
      initialFocus={keep}
    >
      <h2 id="switch-off-title" className="break-words text-lg font-semibold">
        Switch off {portion.name}?
      </h2>
      <p id="switch-off-text" className="mt-3 text-sm">
        It leaves the month screen and the New tenant list. Its payments stay in your Schedule and Payments Log, its tenants stay
        on its tenant page, and you can switch it back on here.
      </p>
      <p className="mt-2 text-sm text-muted">{SWITCH_OFF_RULE}</p>
      <LiveNotice tone="danger" className="mt-3">
        {problem}
      </LiveNotice>
      <div className="mt-4 space-y-3">
        <Button variant="danger" size="lg" className="w-full" onClick={() => void switchOff()} pending={busy} pendingLabel="Switching off…">
          Switch off
        </Button>
        <Button ref={keep} variant="quiet" className="w-full" onClick={onClose} disabled={busy}>
          Keep it on
        </Button>
        <SlowHint busy={busy} />
      </div>
    </Sheet>
  );
}
