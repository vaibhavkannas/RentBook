import "server-only";
import { cookies } from "next/headers";
import type { MonthView, YearMonth } from "@/lib/domain/types";
import { getMonthView, type SheetsContext } from "@/lib/sheets/service";
import { macMatches, sign } from "./signing";

const COOKIE = "rb-wrote";

/** How long the cookie, and so a write time in it, is believed. The cache's own lifetime is 15 seconds. */
const COOKIE_LIFETIME_SECONDS = 120;

/** Servers' clocks can differ a little, so a write time slightly ahead of this server's clock is still believed. */
const MAX_CLOCK_SKEW_MS = 5_000;

/** What the signature covers: the write time and the person it was made for, so it is no good for anyone else. */
const signedText = (writtenAt: string, email: string) => `${writtenAt}:${email.trim().toLowerCase()}`;

/**
 * Remember, in this person's browser, when they last changed the Sheet. The cookie is the time and a signature
 * of the time and the person's email, made with AUTH_SECRET, so a browser cannot write one of its own.
 * This runs after the Sheet was already written, so it never throws: a failure here must not
 * turn a saved change into an error. The cache's 15-second lifetime bounds how stale a view can be.
 */
export async function markWritten(email: string, now = Date.now()): Promise<void> {
  try {
    const writtenAt = String(now);
    (await cookies()).set(COOKIE, `${writtenAt}.${sign(signedText(writtenAt, email))}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_LIFETIME_SECONDS,
    });
  } catch (error) {
    console.error("Could not set the write-time cookie", error);
  }
}

/**
 * When `email` last changed the Sheet, if they did in the last two minutes.
 * The cookie is set by the browser, so a value that is not signed for this person, is older than 120 seconds, or is
 * more than 5 seconds ahead of this server's clock is ignored rather than forcing uncached reads. Never throws.
 */
export async function readWrittenAt(email: string, now = Date.now()): Promise<number | undefined> {
  try {
    const parts = (await cookies()).get(COOKIE)?.value?.split(".");
    if (parts?.length !== 2) return undefined;
    const [writtenAt, mac] = parts;
    if (!/^[0-9]{1,16}$/.test(writtenAt) || !macMatches(signedText(writtenAt, email), mac)) return undefined;
    const value = Number(writtenAt);
    const fresh = value > 0 && value >= now - COOKIE_LIFETIME_SECONDS * 1_000 && value <= now + MAX_CLOCK_SKEW_MS;
    return fresh ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The month view for a page, never older than this person's own last change to the Sheet. */
export async function loadMonthView(ctx: SheetsContext, month: YearMonth, email: string): Promise<MonthView> {
  return getMonthView(ctx, month, { minFetchedAt: await readWrittenAt(email) });
}
