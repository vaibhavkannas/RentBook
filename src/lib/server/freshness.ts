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

/** When this person last changed the Sheet, if they did in the last two minutes. */
export async function readWrittenAt(): Promise<number | undefined> {
  const value = Number((await cookies()).get(COOKIE)?.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
