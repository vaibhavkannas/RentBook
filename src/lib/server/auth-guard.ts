import { auth } from "@/auth";
import { forbidden, unauthorized } from "@/lib/errors";
import { isAllowedEmail, isOwnerEmail, parseAllowedEmails } from "./env";

export type Viewer = { email: string; isOwner: boolean };

/** The signed-in person if they are on the allow-list, otherwise null. Checked on every call. */
export async function getViewer(): Promise<Viewer | null> {
  const session = await auth();
  const email = session?.user?.email;
  const allowed = parseAllowedEmails(process.env);
  if (!email || !isAllowedEmail(email, allowed)) return null;
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
