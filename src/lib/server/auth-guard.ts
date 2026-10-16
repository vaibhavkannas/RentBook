import { auth } from "@/auth";
import { forbidden, unauthorized } from "@/lib/errors";
import { assertAuthConfig, isAllowedEmail, isOwnerEmail, parseAllowedEmails } from "./env";
import { isSessionCurrent } from "./session-policy";

export type Viewer = { email: string; isOwner: boolean };

/**
 * The signed-in person if they are on the allow-list and their session is not older than SESSION_NOT_BEFORE,
 * otherwise null. Checked on every call. A config error when the sign-in settings are not usable (see assertAuthConfig).
 */
export async function getViewer(): Promise<Viewer | null> {
  assertAuthConfig(process.env);
  const session = await auth();
  const email = session?.user?.email;
  const allowed = parseAllowedEmails(process.env);
  // Only an address Google verified gets a session (the sign-in callback checks it), so a session's address is verified.
  if (!email || !isAllowedEmail(email, allowed, true)) return null;
  if (!isSessionCurrent(session.issuedAt, process.env.SESSION_NOT_BEFORE)) return null;
  return { email: email.trim().toLowerCase(), isOwner: isOwnerEmail(email, allowed) };
}

export async function requireUser(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw unauthorized();
  return viewer;
}

export async function requireOwner(): Promise<Viewer> {
  const viewer = await requireUser();
  if (!viewer.isOwner) throw forbidden();
  return viewer;
}
