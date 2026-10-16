import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail, parseAllowedEmails } from "@/lib/server/env";
import { SESSION_MAX_AGE_SECONDS, stampIssuedAt } from "@/lib/server/session-policy";

declare module "next-auth" {
  interface Session {
    /** When this person signed in (ms since epoch). Absent on a session from before sign-in times were kept. */
    issuedAt?: number;
  }
}

// The JWT type is defined in @auth/core (next-auth/jwt re-exports it), so that is the module to extend.
declare module "@auth/core/jwt" {
  interface JWT {
    issuedAt?: number;
  }
}

/**
 * Google sign-in, restricted to ALLOWED_EMAILS. Reads AUTH_SECRET,
 * AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment. A session lasts seven days and remembers when it was
 * signed in, so SESSION_NOT_BEFORE can sign everyone out (see auth-guard.ts).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ profile }) {
      return isAllowedEmail(
        profile?.email,
        parseAllowedEmails(process.env),
        profile?.email_verified === true,
      );
    },
    jwt({ token, trigger }) {
      return stampIssuedAt(token, trigger === "signIn" || trigger === "signUp");
    },
    session({ session, token }) {
      session.issuedAt = typeof token.issuedAt === "number" ? token.issuedAt : undefined;
      return session;
    },
  },
});
