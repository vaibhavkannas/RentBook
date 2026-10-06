import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "@/lib/server/env";

/**
 * Google sign-in, restricted to ALLOWED_EMAIL. Reads AUTH_SECRET,
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
        process.env.ALLOWED_EMAIL,
        profile?.email_verified === true,
      );
    },
  },
});
