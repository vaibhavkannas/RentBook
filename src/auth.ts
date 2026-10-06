import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail, parseAllowedEmails } from "@/lib/server/env";

/**
 * Google sign-in, restricted to ALLOWED_EMAILS. Reads AUTH_SECRET,
 * AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ profile }) {
      return isAllowedEmail(
        profile?.email,
        parseAllowedEmails(process.env),
        profile?.email_verified === true,
      );
    },
  },
});
