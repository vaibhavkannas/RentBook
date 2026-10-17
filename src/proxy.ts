import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspHeaderName, generateNonce, unusedCspHeaderName } from "@/lib/server/csp";

/**
 * Gives every page request its own nonce and Content-Security-Policy. The policy goes on the response, and on
 * the request that is forwarded to the page: Next reads the nonce from it and puts it on its own scripts and
 * styles, and the page can read it as the x-nonce header. A page only receives a nonce when it renders for the
 * request, never when it was built ahead of time. Every page asks getViewer(), which waits for a request with
 * connection(), and not-found does the same.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const name = cspHeaderName(process.env);
  const policy = buildCsp({ nonce, dev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(name, policy);
  // Next reads the enforcing header first. Whichever one is not in use must not come from the browser, or the
  // nonce Next finds would not be this one.
  requestHeaders.delete(unusedCspHeaderName(process.env));

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(name, policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Every path except the API, Next's own files, the icons (/icon, /icon/<id>, /apple-icon, /apple-icon/<id>),
      // the manifest, robots.txt and /.well-known: none of them is a page, so none needs a nonce. A link prefetch is
      // skipped too: it brings no page to run scripts.
      source:
        "/((?!(?:api|_next/static|_next/image|\\.well-known)(?:/|$)|(?:favicon\\.ico|manifest\\.webmanifest|robots\\.txt)$|(?:icon|apple-icon)(?:/[^/]+)?$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
