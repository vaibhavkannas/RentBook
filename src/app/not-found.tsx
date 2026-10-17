import { connection } from "next/server";
import { ButtonLink } from "@/components/ui/Button";
import { Page } from "@/components/ui/Page";
import { BRAND } from "@/lib/brand";

export default async function NotFound() {
  // Render for each request, not ahead of time: only then does the page receive the request's nonce (see proxy.ts).
  await connection();
  return (
    <Page center>
      <h1 className="text-2xl font-semibold">That page was not found.</h1>
      <ButtonLink href="/" className="mt-6">
        {`Back to ${BRAND.name}`}
      </ButtonLink>
    </Page>
  );
}
