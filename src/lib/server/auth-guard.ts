import { auth } from "@/auth";
import { unauthorized } from "@/lib/errors";
import { isAllowedEmail } from "./env";

/** Returns the signed-in owner's email, or throws an `unauthorized` AppError. */
export async function requireUser(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL)) throw unauthorized();
  return email!;
}

/** Same check for pages: true when the visitor is the signed-in owner. */
export async function isSignedIn(): Promise<boolean> {
  const session = await auth();
  return isAllowedEmail(session?.user?.email, process.env.ALLOWED_EMAIL);
}
