import Link from "next/link";
import { redirect } from "next/navigation";
import SettingsForm from "@/components/SettingsForm";
import type { PortionConfig } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";
import { isSignedIn } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { getSettings } from "@/lib/sheets/service";

export default async function SettingsPage() {
  if (!(await isSignedIn())) redirect("/signin");

  let portions: PortionConfig[] | null = null;
  let problem: string | null = null;
  try {
    portions = await getSettings(getSheetsContext());
  } catch (error) {
    if (error instanceof AppError) {
      problem = error.message;
    } else {
      console.error(error);
      problem = "Couldn't reach Google Sheets. Try again.";
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
      <nav className="flex items-center gap-2">
        <Link href="/" aria-label="Back to month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">Portion settings</h1>
      </nav>

      {problem && (
        <p role="alert" className="mt-4 rounded-2xl bg-danger-bg p-4 text-sm text-danger-ink">
          {problem}
        </p>
      )}
      {portions && <SettingsForm portions={portions} />}
    </main>
  );
}
