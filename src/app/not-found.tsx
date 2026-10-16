import Link from "next/link";
import { connection } from "next/server";

export default async function NotFound() {
  // Render for each request, not ahead of time: only then does the page receive the request's nonce (see proxy.ts).
  await connection();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">That page was not found.</h1>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 font-medium text-accent-ink"
      >
        Back to RentBook
      </Link>
    </main>
  );
}
