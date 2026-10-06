import { cookies } from "next/headers";

const COOKIE = "rb-wrote";

/** Remember, in this person's browser, when they last changed the Sheet. */
export async function markWritten(now = Date.now()): Promise<void> {
  (await cookies()).set(COOKIE, String(now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 120,
  });
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
