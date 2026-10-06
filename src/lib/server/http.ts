import type { z } from "zod";
import { AppError, validation } from "@/lib/errors";

const STATUS: Record<AppError["code"], number> = {
  unauthorized: 401,
  forbidden: 403,
  validation: 400,
  conflict: 409,
  "sheet-structure": 422,
  config: 500,
};

/**
 * Runs a route handler body and turns its result or error into JSON.
 * Success: { ok: true, ...result }. Failure: { ok: false, error: { code, message, details? } }.
 * Unknown errors are logged and shown as a generic message.
 */
export async function handle(run: () => Promise<Record<string, unknown>>): Promise<Response> {
  try {
    const result = await run();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(
        { ok: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: STATUS[error.code] },
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
