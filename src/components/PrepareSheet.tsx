"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LiveNotice } from "@/components/ui/Notice";
import { useToast } from "@/components/ui/Toast";
import { sendJson } from "@/lib/post-json";
import { prepareOutcome, type PrepareBody } from "@/lib/prepare-response";
import { PREPARE_NO_CONFIRMATION, sendFailureMessage } from "@/lib/request-copy";

/**
 * The Prepare my Sheet card: what the button will add, and the button. It sends one empty request, and on an answer shows
 * a toast and brings the page up to date, which then shows the tabs as made. A problem shows in the card.
 */
export default function PrepareSheet({ lines }: { lines: readonly string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [updating, startUpdate] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const busy = sending || updating;

  async function prepare() {
    if (busy) return;
    setSending(true);
    setProblem(null);
    const sent = await sendJson<PrepareBody>("/api/setup/prepare", {});
    setSending(false);
    if (sent.kind !== "answer") {
      setProblem(sendFailureMessage(sent, PREPARE_NO_CONFIRMATION));
      return;
    }
    const outcome = prepareOutcome(sent.body);
    if (!outcome.ok) {
      setProblem(outcome.message);
      return;
    }
    toast.show(outcome.toast);
    startUpdate(() => router.refresh());
  }

  return (
    <Card as="section" aria-labelledby="prepare-heading" className="mt-3">
      <h2 id="prepare-heading" className="font-medium">
        Get your Sheet ready
      </h2>
      {lines.map((line) => (
        <p key={line} className="mt-2 text-sm text-muted">
          {line}
        </p>
      ))}
      <Button size="lg" className="mt-3 w-full" pending={busy} pendingLabel="Preparing…" onClick={() => void prepare()}>
        Prepare my Sheet
      </Button>
      <LiveNotice tone="danger" className="mt-3">
        {problem}
      </LiveNotice>
    </Card>
  );
}
