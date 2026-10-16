import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// The headers every response carries, as next.config.ts sets them. The Content-Security-Policy is not here:
// it needs a nonce for each request, so src/proxy.ts sets it (see proxy.test.ts).

async function headersFor(path: string): Promise<Headers> {
  const response = await unstable_getResponseFromNextConfig({ url: `https://rentbook.example.com${path}`, nextConfig });
  return response.headers;
}

const EVERYWHERE = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-robots-tag": "noindex, nofollow",
};

describe("next.config headers", () => {
  it("does not announce the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each([
    "/",
    "/signin",
    "/settings",
    "/tenants/p1",
    "/no-such-page",
    "/api/payments",
    "/_next/static/chunks/main.js",
    "/robots.txt",
    "/.well-known/security.txt",
  ])("sets the security headers on %s", async (path) => {
    const headers = await headersFor(path);
    for (const [name, value] of Object.entries(EVERYWHERE)) {
      expect(headers.get(name), name).toBe(value);
    }
  });

  it("keeps API answers out of every cache", async () => {
    for (const path of ["/api/payments", "/api/payments/log-retry", "/api/settings", "/api/auth/session"]) {
      expect((await headersFor(path)).get("cache-control"), path).toBe("private, no-store, max-age=0");
    }
  });

  it("does not change caching for pages and files", async () => {
    for (const path of ["/", "/signin", "/_next/static/chunks/main.js", "/robots.txt"]) {
      expect((await headersFor(path)).get("cache-control"), path).toBeNull();
    }
  });

  it("leaves the Content-Security-Policy to the proxy", async () => {
    const headers = await headersFor("/signin");
    expect(headers.get("content-security-policy")).toBeNull();
    expect(headers.get("content-security-policy-report-only")).toBeNull();
  });
});
