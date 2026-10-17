import { redirect } from "next/navigation";
import LoadProblem from "@/components/LoadProblem";
import SettingsForm from "@/components/SettingsForm";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import type { PortionConfig } from "@/lib/domain/types";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readWrittenAt } from "@/lib/server/freshness";
import { problemMessage } from "@/lib/server/problem";
import { getSettings } from "@/lib/sheets/service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!viewer.isOwner) redirect("/");

  let portions: PortionConfig[] | null = null;
  let problem: string | null = null;
  try {
    portions = await getSettings(getSheetsContext(), { minFetchedAt: await readWrittenAt(viewer.email) });
  } catch (error) {
    problem = problemMessage(error, viewer);
  }

  return (
    <Page>
      <PageHeader title="Portion settings" back={{ href: "/", label: "Back to month" }} />

      {problem && <LoadProblem message={problem} retryHref="/settings" />}
      {portions && <SettingsForm portions={portions} />}
    </Page>
  );
}
