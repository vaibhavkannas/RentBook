import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isSignedIn } from "@/lib/server/auth-guard";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isSignedIn()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">RentBook</h1>
      <p className="mt-1 text-muted">Sign in to record rent receipts.</p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink"
        >
          {error === "AccessDenied"
            ? "That Google account isn't allowed to use RentBook."
            : "Sign-in failed. Try again."}
        </p>
      )}

      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
