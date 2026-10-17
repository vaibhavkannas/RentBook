"use client";

import Link from "next/link";
import { BRAND } from "@/lib/brand";

// What a person sees when a page or part of a page fails inside the app (the layout above it still works).
// It says nothing about the error itself: the details are in the server log (see src/instrumentation.ts).
// Next gives `retry` for "try again": it fetches the page again and shows it, where `reset` would only draw the
// same failed result a second time.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Something went wrong on our side.</h1>
      <p className="mt-2 text-muted">Your data is safe in your Sheet.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
      >
        Try again
      </button>
      <Link href="/" className="mt-3 inline-flex min-h-11 items-center justify-center text-muted">
        {`Back to ${BRAND.name}`}
      </Link>
    </main>
  );
}
