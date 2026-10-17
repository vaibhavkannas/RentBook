"use client";

import { BRAND } from "@/lib/brand";
import "./globals.css";

// What a person sees when the page frame itself (the root layout) fails. It replaces the layout, so it is a whole
// page with its own <html> and <body>. Next shows it in the browser, from the error answer of the server; the static
// /_global-error page that Next builds ahead of time is its own built-in one and does not use this file.
//
// The way out is a plain link, which loads the whole app again, and not a button that calls retry(): the frame is
// what broke, so starting from a clean page load is safer, and a link needs no script, so it also works where one is
// blocked (a page built ahead of time carries no nonce, and the Content-Security-Policy blocks its scripts).
export default function GlobalError() {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <title>{BRAND.name}</title>
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
          <h1 className="text-2xl font-semibold">Something went wrong on our side.</h1>
          <p className="mt-2 text-muted">Your data is safe in your Sheet.</p>
          {/* A plain <a>, not next/link: see above. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-medium text-accent-ink"
          >
            Try again
          </a>
        </main>
      </body>
    </html>
  );
}
