import { connection } from "next/server";
import { ButtonLink } from "@/components/ui/Button";
import { Page } from "@/components/ui/Page";
import { BRAND } from "@/lib/brand";

export default async function NotFound() {
  // Render for each request, not ahead of time: only then does the page receive the request's nonce (see proxy.ts).
  await connection();
  return (
    // No tab bar on a path that is not under a tab, so no room is kept for one (a tenant that does not exist is, and the
    // bar then sits over the empty bottom of a page whose content is in the middle).
    <Page center tabBar={false}>
      <h1 className="text-2xl font-semibold">That page was not found.</h1>
      <ButtonLink href="/" className="mt-6">
        {`Back to ${BRAND.name}`}
      </ButtonLink>
    </Page>
  );
}
