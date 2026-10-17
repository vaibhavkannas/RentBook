import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { monthParam, withMonth } from "@/lib/app-nav";
import { BRAND } from "@/lib/brand";
import { diagnosticsRows } from "@/lib/diagnostics-view";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { problemCounts } from "@/lib/server/log";
import { setupReport } from "@/lib/server/setup-report";
import pkg from "../../../package.json";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/**
 * How the app and the Sheet are doing, for the owner: the version, whether the Sheet answers and how fast, what each tab
 * holds, and what this server has logged as a problem. It only reads, and shows counts, times and names of tabs: never a
 * secret, a key, a setting's value or a tenant's data (the checks it is built from carry none).
 */
export default async function DiagnosticsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");

  const header = <PageHeader title="Diagnostics" back={{ href: "/more", label: "Back to More" }} />;
  if (!viewer.isOwner) {
    return (
      <Page>
        {header}
        <Notice tone="warn" className="mt-3">
          Diagnostics are for the owner.
        </Notice>
      </Page>
    );
  }

  // The month the person was looking at: Check again and the way to Set up keep it, so the tab bar still leads back to it.
  const month = monthParam((await searchParams)?.month);
  const report = await setupReport(process.env, getSheetsContext);
  const sections = diagnosticsRows({
    version: pkg.version,
    checks: report.checks,
    facts: report.facts,
    problems: problemCounts(),
    appTabNames: report.appTabNames,
    realTitles: report.realTitles,
    setupHref: withMonth("/setup", month),
  });

  return (
    <Page>
      {header}
      <p className="mt-3 text-sm text-muted">
        A quick look at how {BRAND.name} and your Google Sheet are doing. It only reads: nothing in your Sheet changes.
      </p>

      <div className="mt-3 space-y-3">
        {sections.map((section) => (
          <Card as="section" key={section.id} aria-labelledby={`diagnostics-${section.id}`}>
            <h2 id={`diagnostics-${section.id}`} className="font-medium">
              {section.title}
            </h2>
            <ul className="mt-3 space-y-3">
              {section.rows.map((row) => (
                <li key={row.text}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-sm">{row.text}</p>
                    {row.pill && <Pill tone={row.pill.tone}>{row.pill.label}</Pill>}
                  </div>
                  {row.link && (
                    <ButtonLink href={row.link.href} variant="secondary" className="mt-2">
                      {row.link.label}
                    </ButtonLink>
                  )}
                </li>
              ))}
            </ul>
            {section.note && <p className="mt-3 text-sm text-muted">{section.note}</p>}
          </Card>
        ))}
      </div>

      <ButtonLink href={withMonth("/diagnostics", month)} variant="secondary" className="mt-3 w-full">
        Check again
      </ButtonLink>
    </Page>
  );
}
