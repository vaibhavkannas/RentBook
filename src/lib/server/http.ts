import type { z } from "zod";
import { AppError, messageFor, validation } from "@/lib/errors";
import { getViewer } from "./auth-guard";

const STATUS: Record<AppError["code"], number> = {
  unauthorized: 401,
  forbidden: 403,
  validation: 400,
  conflict: 409,
  "sheet-structure": 422,
  config: 500,
  "rate-limited": 429,
  unavailable: 503,
};

/** Seconds a client is asked to wait after "rate-limited". */
const RETRY_AFTER_SECONDS = "30";

/** True when the signed-in person is the owner. A failed or missing sign-in check counts as not the owner. */
async function viewerIsOwner(): Promise<boolean> {
  try {
    return (await getViewer())?.isOwner === true;
  } catch {
    return false;
  }
}

/**
 * Runs a route handler body and turns its result or error into JSON.
 * Success: { ok: true, ...result }. Failure: { ok: false, error: { code, message, details? } }.
 * Unknown errors are logged and shown as a generic message. A config error (the connection to the Sheet) is
 * logged in full, and only the owner is shown its detail: everyone else is told to ask the owner.
 */
export async function handle(run: () => Promise<Record<string, unknown>>): Promise<Response> {
  try {
    const result = await run();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      let message = error.message;
      if (error.code === "config") {
        console.error("Sheet connection problem:", error.message);
        message = messageFor(error, await viewerIsOwner());
      }
      return Response.json(
        { ok: false, error: { code: error.code, message, details: error.details } },
        {
          status: STATUS[error.code],
          headers: error.code === "rate-limited" ? { "Retry-After": RETRY_AFTER_SECONDS } : undefined,
        },
      );
    }
    console.error(error);
    return Response.json(
      { ok: false, error: { code: "internal", message: "Something went wrong. Try again." } },
      { status: 500 },
    );
  }
}

export async function parseJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validation("Request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw validation(`${where}${issue.message}`);
  }
  return parsed.data;
}
