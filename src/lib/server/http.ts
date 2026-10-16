import "server-only";
import type { z } from "zod";
import {
  AppError,
  crossOriginRequest,
  messageFor,
  payloadTooLarge,
  unsupportedMediaType,
  validation,
} from "@/lib/errors";
import { getViewer, type Viewer } from "./auth-guard";
import { describeError, logEvent, messageForLog, requestIdFrom, type LogLevel } from "./log";

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

/** How loudly an error is logged: what a person caused is info, what Google is doing is warn, what needs fixing is error. */
const LOG_LEVEL: Record<AppError["code"], LogLevel> = {
  unauthorized: "info",
  forbidden: "info",
  validation: "info",
  conflict: "info",
  "rate-limited": "warn",
  unavailable: "warn",
  config: "error",
  "sheet-structure": "error",
};

/** Seconds a client is asked to wait after "rate-limited". */
const RETRY_AFTER_SECONDS = "30";

/** The signed-in person, or null when there is none or the sign-in check failed. */
async function currentViewer(): Promise<Viewer | null> {
  try {
    return await getViewer();
  } catch {
    return null;
  }
}

/**
 * Runs a route handler body and turns its result or error into JSON.
 * Success: { ok: true, ...result }. Failure: { ok: false, error: { code, message, details? }, requestId }.
 * Every failure is logged as one line (see log.ts) with the request id that the answer carries, so a report of
 * "it failed" can be found in the log. The id is the x-vercel-id of `request`, or a new one.
 * Unknown errors are logged and shown as a generic message. A config error (the connection to the Sheet) is
 * logged in full, and only the owner is shown its detail: everyone else is told to ask the owner.
 */
export async function handle(run: () => Promise<Record<string, unknown>>, request?: Request): Promise<Response> {
  try {
    const result = await run();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const requestId = requestIdFrom(request?.headers.get("x-vercel-id"));
    const route = request ? new URL(request.url).pathname : undefined;
    if (error instanceof AppError) {
      let message = error.message;
      let viewer: Viewer | null = null;
      if (error.code === "config") {
        viewer = await currentViewer();
        message = messageFor(error, viewer?.isOwner === true);
      }
      logEvent(LOG_LEVEL[error.code], "api-error", {
        requestId,
        route,
        code: error.code,
        message: messageForLog(error),
        viewer: viewer?.email,
      });
      return Response.json(
        { ok: false, error: { code: error.code, message, details: error.details }, requestId },
        {
          status: error.status ?? STATUS[error.code],
          headers: error.code === "rate-limited" ? { "Retry-After": RETRY_AFTER_SECONDS } : undefined,
        },
      );
    }
    logEvent("error", "api-error", { requestId, route, code: "internal", message: describeError(error) });
    return Response.json(
      { ok: false, error: { code: "internal", message: "Something went wrong. Try again." }, requestId },
      { status: 500 },
    );
  }
}

/** The largest request body the app accepts. Its own requests are far smaller. */
export const MAX_BODY_BYTES = 32 * 1024;

/**
 * The host the browser asked for. Behind a proxy that is X-Forwarded-Host (its first value), otherwise Host,
 * otherwise the host of the request's own address.
 */
function requestHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return (forwarded || request.headers.get("host") || new URL(request.url).host).toLowerCase();
}

/** The host of an Origin header, or null when it is not an address ("null", or nonsense). */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Refuses a request that did not come from the app's own page, or is not JSON.
 * - Sec-Fetch-Site, when the browser sends it, must be "same-origin". Anything else (cross-site, same-site, none,
 *   empty) is a 403.
 * - Origin, when present, must be this host. A different host, a different port or something that is not an address
 *   is a 403.
 * - Content-Type must be application/json (a charset is fine). Anything else is a 415. A cross-site form can only
 *   send text, so this alone stops one; the other two checks are the second lock.
 * The cross-site checks come first: a request from another site that is also not JSON is told the more telling 403.
 * A tool that sends neither Sec-Fetch-Site nor Origin is judged by its content type alone, and still needs a session.
 */
export function assertJsonSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") throw crossOriginRequest();
  const origin = request.headers.get("origin");
  if (origin !== null && originHost(origin) !== requestHost(request)) throw crossOriginRequest();
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw unsupportedMediaType();
}

/** The body as text, read at most up to MAX_BODY_BYTES: a longer stream is cancelled, not read to its end. */
async function readLimitedText(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The JSON body of a request, after the checks every route makes first: the request is from the app's own page
 * and says it is JSON (assertJsonSameOrigin), and the body is no more than 32 KB, by its announced length and by
 * what actually arrives. Routes call this BEFORE they ask who is signed in, so a refused request costs nothing.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  assertJsonSameOrigin(request);
  const announced = Number(request.headers.get("content-length"));
  if (announced > MAX_BODY_BYTES) throw payloadTooLarge();
  const text = await readLimitedText(request);
  try {
    return JSON.parse(text);
  } catch {
    throw validation("Request body must be JSON.");
  }
}

/** The body checked against `schema`: typed data, or a validation error naming the first field that is wrong. */
export function parseBody<T extends z.ZodType>(body: unknown, schema: T): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw validation(`${where}${issue.message}`);
  }
  return parsed.data;
}
