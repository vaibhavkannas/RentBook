import type { Instrumentation } from "next";
import { AppError } from "@/lib/errors";
import { describeError, logEvent, messageForLog, requestIdFrom } from "@/lib/server/log";

/** The digest React gives an error that reaches the browser's error page, so that page and this log can be matched. */
function digestOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  return typeof error.digest === "string" && error.digest !== "" ? error.digest : undefined;
}

/**
 * Next calls this for an error on the server that nothing caught: a page that failed to render, or a route that
 * threw outside handle(). It writes the same one-line log as handle() does (see log.ts). Of the request it keeps
 * only the x-vercel-id: the address can carry a query string and the headers carry cookies, so neither is logged.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const vercelId = request.headers["x-vercel-id"];
  const digest = digestOf(error);
  const what = error instanceof AppError ? messageForLog(error) : describeError(error);
  logEvent("error", "request-error", {
    requestId: requestIdFrom(Array.isArray(vercelId) ? vercelId[0] : vercelId),
    route: context.routePath,
    code: error instanceof AppError ? error.code : "internal",
    message: digest ? `${what} (digest ${digest})` : what,
  });
};
