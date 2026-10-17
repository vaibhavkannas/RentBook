import { redirect } from "next/navigation";
import CheckList from "@/components/CheckList";
import PrepareSheet from "@/components/PrepareSheet";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { monthParam, withMonth } from "@/lib/app-nav";
import { BRAND } from "@/lib/brand";
import { LAYOUT_RULES } from "@/lib/layout-rules";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { setupReport } from "@/lib/server/setup-report";
import { headline } from "@/lib/setup-checks";
import { prepareOffer } from "@/lib/setup-prepare";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

/**
 * The owner's guided check of the connection between the app and the Google Sheet: each part in its own card, what was
 * found and what to do. It only reads. The one thing that changes the Sheet is the Prepare my Sheet button, which makes
 * the tabs the app needs. It never shows a secret, a key, a setting's value or a tenant's data (see setup-env.ts and
 * sheet-checks.ts); the service account's address is the one thing taken from the settings, so the owner can share the Sheet.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");

  const header = <PageHeader title="Set up" back={{ href: "/more", label: "Back to More" }} />;
  if (!viewer.isOwner) {
    return (
      <Page>
        {header}
        <Notice tone="warn" className="mt-3">
          Set up is for the owner. If something isn&apos;t working, ask the owner to open it.
        </Notice>
      </Page>
    );
  }

  // The month the person was looking at: the links keep it, so the tab bar and the way back still lead to it.
  const month = monthParam((await searchParams)?.month);
  const { checks, facts, appTabNames } = await setupReport(process.env, getSheetsContext);
  const offer = prepareOffer(checks, facts, appTabNames ?? {});
  const settingsReady = checks.some((check) => check.id === "settings" && check.status === "ok");
  const allGood = checks.every((check) => check.status === "ok");

  return (
    <Page>
      {header}
      <p className="mt-3 text-sm text-muted">
        This page checks each part of the connection between {BRAND.name} and your Google Sheet. It only reads: nothing in your
        Sheet changes unless you tap Prepare my Sheet.
      </p>
      <Notice tone={allGood ? "success" : "warn"} role="status" className="mt-3">
        {headline(checks)}
      </Notice>

      {offer && <PrepareSheet lines={offer.lines} />}

      <CheckList
        checks={checks}
        extras={{
          6: (
            <>
              <p className="mt-3 text-sm text-muted">
                Set each portion&apos;s payments per cycle (or Count never resets) and hike before the first payment: the app
                cannot change a payment count later.
              </p>
              {settingsReady && (
                <ButtonLink href={withMonth("/settings", month)} variant="secondary" className="mt-3">
                  Open Portion settings
                </ButtonLink>
              )}
            </>
          ),
        }}
      />

      <Card className="mt-3">
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-medium">What your Sheet needs</summary>
          <dl className="mt-2 space-y-3 text-sm">
            {LAYOUT_RULES.map(({ topic, text }) => (
              <div key={topic}>
                <dt className="font-medium">{topic}</dt>
                <dd className="mt-1 text-muted">{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Card>

      <ButtonLink href={withMonth("/setup", month)} variant="secondary" className="mt-3 w-full">
        Check again
      </ButtonLink>
    </Page>
  );
}
