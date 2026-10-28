"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LiveNotice } from "@/components/ui/Notice";
import { useToast } from "@/components/ui/Toast";
import type { PortionConfig } from "@/lib/domain/types";
import type { PortionsApiBody } from "@/lib/portion-requests";
import { sendJson } from "@/lib/post-json";
import { apiErrorMessage, PORTION_NO_CONFIRMATION, sendFailureMessage } from "@/lib/request-copy";
import { portionSwitchedOnToastText } from "@/lib/toast-copy";

type Props = {
  /** The portions that are switched off. */
  portions: PortionConfig[];
  /** One is on again. `portions` are all the portions as the Sheet now has them. */
  onSwitchedOn: (portions: PortionConfig[] | undefined) => void;
};

/** The "Switched off" section of Portion settings: a card for each portion that is off, hidden but with its history, and a way back on. */
export default function SwitchedOffPortions({ portions, onSwitchedOn }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [switchingOn, setSwitchingOn] = useState<string | null>(null);
  // What the Sheet said when it refused, and for which portion.
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);

  async function switchOn(portion: PortionConfig) {
    if (switchingOn !== null) return;
    setSwitchingOn(portion.id);
    setProblem(null);
    const sent = await sendJson<PortionsApiBody>("/api/portions/active", { id: portion.id, active: true }, { method: "PUT" });
    setSwitchingOn(null);
    if (sent.kind !== "answer") return setProblem({ id: portion.id, message: sendFailureMessage(sent, PORTION_NO_CONFIRMATION) });
    if (!sent.body.ok) {
      if (sent.body.error?.code === "conflict") router.refresh();
      return setProblem({ id: portion.id, message: apiErrorMessage(sent.body.error) });
    }
    toast.show(portionSwitchedOnToastText(portion.name));
    router.refresh();
    onSwitchedOn(sent.body.portions);
  }

  if (portions.length === 0) return null;
  return (
    <section aria-labelledby="switched-off-heading" className="mt-6">
      <h2 id="switched-off-heading" className="text-sm text-muted">
        Switched off
      </h2>
      <div className="mt-2 space-y-3">
        {portions.map((portion) => (
          <Card key={portion.id}>
            <p className="break-words font-medium">{portion.name}</p>
            <p className="mt-1 text-sm text-muted">Hidden from the month screen. History kept.</p>
            <LiveNotice tone="danger" className="mt-3">
              {problem?.id === portion.id ? problem.message : null}
            </LiveNotice>
            <Button
              variant="secondary"
              className="mt-3"
              aria-label={`Switch on ${portion.name}`}
              onClick={() => void switchOn(portion)}
              pending={switchingOn === portion.id}
              pendingLabel="Switching on…"
              disabled={switchingOn !== null && switchingOn !== portion.id}
            >
              Switch on
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}
