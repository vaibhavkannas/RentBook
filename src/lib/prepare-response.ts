import { apiErrorMessage } from "@/lib/request-copy";
import { prepareToastText } from "@/lib/toast-copy";

/** The JSON the Prepare my Sheet route answers with: the tabs it made and the tabs it filled, or an error. */
export type PrepareBody = {
  ok: boolean;
  created?: string[];
  filled?: string[];
  error?: { code: string; message: string; details?: Record<string, unknown> };
};

/**
 * What the card does with the server's answer: show a toast (and bring the page up to date), or say what is wrong. A
 * request that got no answer is the card's own business (sendFailureMessage). Pure, so the words can be tested.
 */
export function prepareOutcome(body: PrepareBody): { ok: true; toast: string } | { ok: false; message: string } {
  if (body.ok) return { ok: true, toast: prepareToastText(body.created ?? [], body.filled ?? []) };
  return { ok: false, message: apiErrorMessage(body.error) };
}
