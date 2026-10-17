import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { BrandMark } from "@/components/ui/BrandMark";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { monthParam, withMonth } from "@/lib/app-nav";
import { BRAND } from "@/lib/brand";
import { getViewer } from "@/lib/server/auth-guard";
import { CARD, cx } from "@/lib/ui-classes";
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

  return (
    <Page>
      <PageHeader title="More" />

      <Card as="section" aria-labelledby="account-heading" className="mt-3">
        <h2 id="account-heading" className="text-sm text-muted">
          Account
        </h2>
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="min-w-0 break-words">Signed in as {viewer.email}</p>
          <Pill tone={viewer.isOwner ? "success" : "neutral"}>{viewer.isOwner ? "Owner" : "Member"}</Pill>
        </div>
      </Card>

      {viewer.isOwner && (
        <Link
          href={withMonth("/settings", month)}
          className={cx(CARD, "press mt-3 flex min-h-11 items-center justify-between gap-3")}
        >
          <span>
            <span className="block font-medium">Portion settings</span>
            <span className="block text-sm text-muted">Cycle lengths and hike percentages</span>
          </span>
          <span aria-hidden="true" className="text-xl text-muted">
            ›
          </span>
        </Link>
      )}

      <form
        className="mt-3"
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
        <span>{BRAND.name}</span>
        <span>Version {pkg.version}</span>
      </p>
    </Page>
  );
}
