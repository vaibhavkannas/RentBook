import { cookies } from "next/headers";
import type { MonthView, YearMonth } from "@/lib/domain/types";
import { getMonthView, type SheetsContext } from "@/lib/sheets/service";

const COOKIE = "rb-wrote";

/**
 * Remember, in this person's browser, when they last changed the Sheet.
 * This runs after the Sheet was already written, so it never throws: a failure here must not
 * turn a saved change into an error. The cache's 15-second lifetime bounds how stale a view can be.
 */
export async function markWritten(now = Date.now()): Promise<void> {
  try {
    (await cookies()).set(COOKIE, String(now), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 120,
    });
  } catch (error) {
    console.error("Could not set the write-time cookie", error);
  }
}

/** Servers' clocks can differ a little, so a write time slightly ahead of this server's clock is still believed. */
const MAX_CLOCK_SKEW_MS = 5_000;

/**
 * When this person last changed the Sheet, if they did in the last two minutes.
 * The cookie is set by the browser, so a value that cannot be a real write time
 * (zero, negative or in the future) is ignored rather than forcing uncached reads.
 */
export async function readWrittenAt(now = Date.now()): Promise<number | undefined> {
  const value = Number((await cookies()).get(COOKIE)?.value);
  return Number.isFinite(value) && value > 0 && value <= now + MAX_CLOCK_SKEW_MS ? value : undefined;
}

/** The month view for a page, never older than this person's own last change to the Sheet. */
export async function loadMonthView(ctx: SheetsContext, month: YearMonth): Promise<MonthView> {
  return getMonthView(ctx, month, { minFetchedAt: await readWrittenAt() });
}
