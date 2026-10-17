"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Page } from "@/components/ui/Page";
import { BRAND } from "@/lib/brand";

// What a person sees when a page or part of a page fails inside the app (the layout above it still works).
// It says nothing about the error itself: the details are in the server log (see src/instrumentation.ts).
// Next gives `retry` for "try again": it fetches the page again and shows it, where `reset` would only draw the
// same failed result a second time.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Page center>
      <h1 className="text-2xl font-semibold">Something went wrong on our side.</h1>
      <p className="mt-2 text-muted">Your data is safe in your Sheet.</p>
      <Button size="lg" className="mt-6 w-full" onClick={() => retry()}>
        Try again
      </Button>
      <ButtonLink href="/" variant="quiet" className="mt-3">
        {`Back to ${BRAND.name}`}
      </ButtonLink>
    </Page>
  );
}
