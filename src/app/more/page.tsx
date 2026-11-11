import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import Appearance from "@/components/Appearance";
import { BrandMark } from "@/components/ui/BrandMark";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { MenuGroup, MenuRow } from "@/components/ui/MenuGroup";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { monthParam, withMonth } from "@/lib/app-nav";
import { BRAND } from "@/lib/brand";
import { getViewer } from "@/lib/server/auth-guard";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import pkg from "../../../package.json";

// This page reads no Sheet, so it sets no time limit of its own (see tests/server/max-duration.test.ts).

export default async function MorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");

  // The month the person was looking at, so the settings page, and the arrow back from it, keep it.
  const month = monthParam((await searchParams).month);
  // The Appearance choice, so the right button is pressed in the first paint.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <Page>
      <PageHeader title="More" />

      <Card as="section" aria-labelledby="account-heading" className="mt-3">
        <SectionLabel id="account-heading" className="">
          Account
        </SectionLabel>
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="min-w-0 break-words">Signed in as {viewer.email}</p>
          <Pill tone={viewer.isOwner ? "success" : "neutral"}>{viewer.isOwner ? "Owner" : "Member"}</Pill>
        </div>
      </Card>

      <section aria-labelledby="rent-heading">
        <SectionLabel id="rent-heading">Rent</SectionLabel>
        <MenuGroup>
          <MenuRow href={withMonth("/overdue", month)} icon="warn" title="Overdue rent" hint="Who owes what, most first" />
          <MenuRow href={withMonth("/year", month)} icon="grid" title="Year at a glance" hint="Each portion, month by month" />
          <MenuRow href={withMonth("/alerts", month)} icon="bell" title="Agreements and hikes" hint="Agreements ending and rent going up" />
        </MenuGroup>
      </section>

      {viewer.isOwner && (
        <section aria-labelledby="owner-heading">
          <SectionLabel id="owner-heading">Owner</SectionLabel>
          <MenuGroup>
            <MenuRow
              href={withMonth("/settings", month)}
              icon="cog"
              title="Portion settings"
              hint="Cycles, hikes, and adding or switching off portions"
            />
            <MenuRow href={withMonth("/setup", month)} icon="check" title="Set up" hint="Check each part of the connection to your Sheet" />
            <MenuRow href={withMonth("/diagnostics", month)} icon="list" title="Diagnostics" hint="How the app and your Sheet are doing" />
          </MenuGroup>
        </section>
      )}

      <section aria-labelledby="appearance-heading">
        <SectionLabel id="appearance-heading">Appearance</SectionLabel>
        <Appearance initial={theme} />
      </section>

      <form
        className="mt-5"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <SubmitButton variant="secondary" pendingLabel="Signing out…" className="w-full">
          Sign out
        </SubmitButton>
      </form>

      <p className="mt-8 flex items-center justify-center gap-2 text-sm text-muted">
        <BrandMark size={20} />
        <span>
          {BRAND.name} · Version {pkg.version}
        </span>
      </p>
    </Page>
  );
}
