import "server-only";
import { AppError } from "@/lib/errors";

// The server log. Every line is one JSON object, so a log search can filter on its fields. It imports no framework
// code, so the route handlers, the Sheets service and instrumentation.ts all use it.

export type LogLevel = "info" | "warn" | "error";

/**
 * The only fields a line can carry. Nothing else reaches the log: a request or response body, a token, a tenant's
 * name and a phone number are not fields here, and one passed as its own field by mistake is dropped (see
 * `logEvent`). Free text in `message` is not checked: keeping names and numbers out of it is the caller's job.
 */
export type LogFields = {
  /** Ties the line to the answer the browser got (see `requestIdFrom`). */
  requestId?: string;
  /** The path of the route, never its query string. */
  route?: string;
  /** The AppError code, or "internal". */
  code?: string;
  /** A short sentence about what happened. It is the caller's job to keep names and numbers of people out of it. */
  message?: string;
  /** The signed-in person's address, written in lower case. */
  viewer?: string;
};

const MAX_MESSAGE_LENGTH = 500;

/** When this module was loaded: the time the counts of `problemCounts` start from. */
const COUNTING_SINCE = new Date().toISOString();

/** How many warn and error lines have been written since, by code (or by event when a line has none). Maps, so a code such as `__proto__` is a plain name. */
const COUNTS: Record<"warn" | "error", Map<string, number>> = { warn: new Map(), error: new Map() };

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * Writes one line to the console: `{ts, level, event, requestId, route, code, message, viewer}`, leaving out what
 * was not given. `event` names what happened, in kebab-case. An info line goes to console.info, a warn line to
 * console.warn and an error line to console.error, so the host shows the right level.
 *
 * The line is built from the listed fields one by one, never by copying `fields`: any other key is dropped, and so
 * is a listed field that is not text.
 */
export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const message = text(fields.message);
  const route = text(fields.route);
  const viewer = text(fields.viewer);
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    requestId: text(fields.requestId),
    route: route?.split(/[?#]/)[0],
    code: text(fields.code),
    message:
      message !== undefined && message.length > MAX_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
        : message,
    viewer: viewer?.trim().toLowerCase(),
  };
  if (level !== "info") {
    const counts = COUNTS[level];
    const key = line.code ?? event;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // JSON.stringify leaves out the fields that are undefined and writes a line break inside a string as \n.
  console[level](JSON.stringify(line));
}

/**
 * What has gone wrong on this server instance since it started: the warn lines and the error lines written so far,
 * counted by code (the event when a line has no code). Info lines are people's own mistakes, so they are not counted.
 * Only numbers and names, never a message. Each server instance counts for itself and starts again from zero when it
 * restarts, so this says how this instance has been doing, not the whole app. The answer is a copy.
 */
export function problemCounts(): { since: string; warn: Record<string, number>; error: Record<string, number> } {
  return {
    since: COUNTING_SINCE,
    warn: Object.fromEntries(COUNTS.warn),
    error: Object.fromEntries(COUNTS.error),
  };
}

/** What a request id may look like: Vercel's (`iad1::sfo1::abcde-1760592600000-0123456789ab`) and our own UUIDs. */
const REQUEST_ID = /^[A-Za-z0-9:._-]{1,200}$/;

/**
 * The id of a request: the x-vercel-id header Vercel puts on it, or a new UUID when there is none. Anyone can send
 * that header to a server that nothing sits in front of, so only an id of plain characters and a sensible length is
 * used. The id goes in the log and in the body of an error answer, so a report of "it failed" can be found in the log.
 */
export function requestIdFrom(vercelId: string | null | undefined): string {
  return vercelId && REQUEST_ID.test(vercelId) ? vercelId : crypto.randomUUID();
}

/**
 * Why a call failed, in a few words, for the server log: the kind of error and its message, never the error
 * object (a library's error can carry the request it made, headers and all).
 */
export function describeError(error: unknown): string {
  if (error instanceof AppError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "unknown error";
}

/**
 * What the log says about an AppError in place of its text. A conflict names what changed, and that can be a
 * tenant ("Asha has already moved out"), so only its code is logged and a fixed sentence stands in for its text.
 * The other codes say what is wrong with the request, the Sheet or the setup, which is what the log is for.
 */
export function messageForLog(error: AppError): string {
  return error.code === "conflict" ? "The Sheet no longer matches what the person was looking at." : error.message;
}

/**
 * The `code` and `message` of a line about a caught `error`, for the sites that log a failure they handle
 * themselves (handle() and instrumentation.ts build the same two fields for an answer or an uncaught error).
 * `what` says where it happened and what it left behind; the error follows in brackets, as `messageForLog` for
 * an AppError (with its code in `code`) and as `describeError` for anything else (no code). The error object
 * itself is never printed, so what a library's error carries along never reaches the log.
 */
export function errorLogFields(error: unknown, what: string): Pick<LogFields, "code" | "message"> {
  if (error instanceof AppError) return { code: error.code, message: `${what} (${messageForLog(error)}).` };
  return { message: `${what} (${describeError(error)}).` };
}
