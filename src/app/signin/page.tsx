import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { BrandMark } from "@/components/ui/BrandMark";
import { Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { BRAND } from "@/lib/brand";
import { getViewer } from "@/lib/server/auth-guard";

/** What to tell a person Google sent back with an error. The error's own name is for the log, not for the screen. */
function errorMessage(error: string): string {
  switch (error) {
    case "AccessDenied":
      return `That Google account isn't on the list for ${BRAND.name}. Ask the owner to add it, or sign in with another account.`;
    case "Configuration":
      return "Sign-in isn't set up correctly. If you are the owner, check the sign-in settings in SETUP.md.";
    default:
      return "Sign-in didn't work. Try again.";
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getViewer()) redirect("/");
  const { error } = await searchParams;

  return (
    <Page center>
      <BrandMark size={56} className="text-accent" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{BRAND.name}</h1>
      <p className="mt-1 text-muted">{BRAND.tagline}</p>

      <p className="mt-8">Sign in with the Google account the owner added.</p>

      {error && (
        <Notice tone="danger" role="alert" className="mt-4">
          {errorMessage(error)}
        </Notice>
      )}

      <form
        className="mt-4"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <SubmitButton pendingLabel="Opening Google…" className="w-full">
          Sign in with Google
        </SubmitButton>
      </form>

      <p className="mt-4 text-sm text-muted">Your records stay in your own Google Sheet.</p>
    </Page>
  );
}
