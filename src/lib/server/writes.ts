import { AppError } from "@/lib/errors";
import { markWritten } from "./freshness";

/**
 * Runs a change to the Sheet and keeps this person's next page view fresh.
 * After a success, the write time is marked. After a conflict, it is marked too: the person's screen
 * was stale, so the refresh that follows must not be answered from the 15-second cache, which another
 * server instance may still hold. Every other failure is passed on untouched.
 */
export async function runWrite<T>(write: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await write();
  } catch (error) {
    if (error instanceof AppError && error.code === "conflict") await markWritten();
    throw error;
  }
  await markWritten();
  return result;
}
