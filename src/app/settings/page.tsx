import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import SettingsForm from "@/components/SettingsForm";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import type { PortionConfig } from "@/lib/domain/types";
import { monthParam, withMonth } from "@/lib/app-nav";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readWrittenAt } from "@/lib/server/freshness";
import { problemMessage, setupHrefFor } from "@/lib/server/problem";
import { getSettings } from "@/lib/sheets/service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!viewer.isOwner) redirect("/");
  // The month the person was looking at: Try again keeps it, so the tab bar and the way back still lead to it.
  const month = monthParam((await searchParams)?.month);

  let portions: PortionConfig[] | null = null;
  let problem: string | null = null;
  let setupHref: string | undefined;
  try {
    portions = await getSettings(getSheetsContext(), { minFetchedAt: await readWrittenAt(viewer.email) });
  } catch (error) {
    problem = problemMessage(error, viewer);
    setupHref = setupHrefFor(error, viewer, month);
  }

  return (
    <Page>
      <PageHeader title="Portion settings" back={{ href: "/more", label: "Back to More" }} />

      {problem && <LoadProblem message={problem} retryHref={withMonth("/settings", month)} setupHref={setupHref} />}
      {portions && <SettingsForm portions={portions} />}
    </Page>
  );
}
