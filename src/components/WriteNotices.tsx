"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useToast } from "@/components/ui/Toast";
import { logRetryFailureMessage, LOG_RETRY_UNUSABLE_MESSAGE, type LogRetryResponse } from "@/lib/payment-request";
import { sendJson } from "@/lib/post-json";
import { sendFailureMessage } from "@/lib/request-copy";
import { LOG_RETRY_UNCONFIRMED_MESSAGE } from "@/lib/payment-request";
import { writeNotices } from "@/lib/write-notices";

const NONE: never[] = [];

/**
 * Where what a save has to tell the owner is shown when its sheet is gone: the Payments Log retry (with the same token the sheet
 * would have used), the tenancy warning, a duplicate. It sits in the root layout, so it outlives every screen: a save answered
 * after the person opened another sheet or moved to another tab is not lost. Nothing here changes a request or a route.
 */
export default function WriteNotices() {
  const notices = useSyncExternalStore(writeNotices.subscribe, writeNotices.get, () => NONE);
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  if (notices.length === 0) return null;

  async function retry(id: number, token: string) {
    setBusy(id);
    const sent = await sendJson<LogRetryResponse>("/api/payments/log-retry", { token });
    setBusy(null);
    const body = sent.kind === "answer" ? sent.body : null;
    if (body?.ok && body.logWritten) {
      writeNotices.remove(id);
      return toast.show("Payments Log entry saved");
    }
    const text = sent.kind === "answer" ? logRetryFailureMessage(body) : sendFailureMessage(sent, LOG_RETRY_UNCONFIRMED_MESSAGE);
    // A refused token cannot be retried; a retry that got no answer may have saved, so it is not offered again either.
    writeNotices.update(id, { text, ...(body === null || text === LOG_RETRY_UNUSABLE_MESSAGE ? { retryToken: undefined } : {}) });
  }

  return (
    <div className="fixed inset-x-4 top-3 z-50 mx-auto max-w-md space-y-2">
      {notices.map((notice) => (
        <Notice key={notice.id} tone="warn" as="div" role="alert" className="space-y-2 shadow-card">
          <p>{notice.text}</p>
          <div className="flex gap-2">
            {notice.retryToken !== undefined && (
              <Button variant="outline" className="flex-1" pending={busy === notice.id} pendingLabel="Retrying…" onClick={() => retry(notice.id, notice.retryToken!)}>
                Retry log entry
              </Button>
            )}
            <Button variant="outline" className="flex-1" disabled={busy === notice.id} onClick={() => writeNotices.remove(notice.id)}>
              Dismiss
            </Button>
          </div>
        </Notice>
      ))}
    </div>
  );
}
