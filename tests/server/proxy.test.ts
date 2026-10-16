import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

// The proxy gives every page request its own nonce and Content-Security-Policy. Next reads the policy off the
// request it forwards to the page, finds the nonce in it, and puts that nonce on its own scripts and styles.

afterEach(() => vi.unstubAllEnvs());

function get(path = "/signin", headers: Record<string, string> = {}) {
  return proxy(new NextRequest(`https://rentbook.example.com${path}`, { headers }));
}

/** A header the proxy asked Next to set on the request it forwards to the page. */
function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

function nonceOf(policy: string | null): string {
  const match = /script-src [^;]*'nonce-([^']+)'/.exec(policy ?? "");
  if (!match) throw new Error(`no nonce in: ${policy}`);
  return match[1];
}

describe("proxy", () => {
  it("puts the policy on the response, with the nonce it also hands to the page as x-nonce", () => {
    const response = get();
    const policy = response.headers.get("Content-Security-Policy");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("'strict-dynamic'");
    expect(forwarded(response, "x-nonce")).toBe(nonceOf(policy));
  });

  it("forwards the same policy to the page, which is where Next finds the nonce", () => {
    const response = get();
    expect(forwarded(response, "content-security-policy")).toBe(response.headers.get("Content-Security-Policy"));
    expect(response.headers.get("x-middleware-override-headers")).toContain("content-security-policy");
    expect(response.headers.get("x-middleware-override-headers")).toContain("x-nonce");
  });

  it("uses a new nonce for every request", () => {
    const nonces = new Set(Array.from({ length: 20 }, () => nonceOf(get().headers.get("Content-Security-Policy"))));
    expect(nonces.size).toBe(20);
  });

  it("ignores an x-nonce or a policy sent by the browser", () => {
    const response = get("/signin", {
      "x-nonce": "attacker",
      "content-security-policy": "script-src 'nonce-attacker'",
    });
    expect(forwarded(response, "x-nonce")).not.toBe("attacker");
    expect(forwarded(response, "content-security-policy")).not.toContain("attacker");
  });

  it("is the production policy, with no eval, outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const policy = get().headers.get("Content-Security-Policy");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain(`style-src 'self' 'nonce-${nonceOf(policy)}'`);
  });

  it("is the development policy in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const policy = get().headers.get("Content-Security-Policy");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  });

  describe("with CSP_REPORT_ONLY=1", () => {
    it("reports violations instead of blocking them, and still hands the page its nonce", () => {
      vi.stubEnv("CSP_REPORT_ONLY", "1");
      const response = get();
      const policy = response.headers.get("Content-Security-Policy-Report-Only");
      expect(policy).toContain("default-src 'self'");
      expect(response.headers.get("Content-Security-Policy")).toBeNull();
      expect(forwarded(response, "content-security-policy-report-only")).toBe(policy);
      expect(forwarded(response, "x-nonce")).toBe(nonceOf(policy));
    });

    it("does not let a policy header sent by the browser stand in for the page's nonce", () => {
      vi.stubEnv("CSP_REPORT_ONLY", "1");
      const response = get("/signin", { "content-security-policy": "script-src 'nonce-attacker'" });
      const overridden = response.headers.get("x-middleware-override-headers") ?? "";
      expect(overridden.split(",")).not.toContain("content-security-policy");
      expect(forwarded(response, "content-security-policy")).toBeNull();
    });
  });

  it("enforces by default, and drops a report-only header sent by the browser", () => {
    const response = get("/signin", { "content-security-policy-report-only": "default-src 'none'" });
    expect(response.headers.get("Content-Security-Policy")).not.toBeNull();
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    expect(forwarded(response, "content-security-policy-report-only")).toBeNull();
  });

  it("lets the request through to the page", () => {
    expect(get().headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy matcher", () => {
  const runs = (url: string, headers?: Record<string, string>) =>
    unstable_doesMiddlewareMatch({ config, url, headers });

  it.each([
    "/",
    "/?month=2026-10",
    "/signin",
    "/settings",
    "/activity",
    "/tenants/p1",
    "/no-such-page",
    "/api-notes",
    "/iconography",
  ])("runs on the page %s", (path) => {
    expect(runs(path)).toBe(true);
  });

  it.each([
    "/api",
    "/api/payments",
    "/api/payments/log-retry",
    "/api/auth/session",
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/favicon.ico",
    "/icon",
    "/apple-icon",
    "/manifest.webmanifest",
    "/robots.txt",
    "/.well-known/security.txt",
  ])("does not run on %s", (path) => {
    expect(runs(path)).toBe(false);
  });

  it("does not run on a link prefetch", () => {
    expect(runs("/settings", { "next-router-prefetch": "1" })).toBe(false);
    expect(runs("/settings", { purpose: "prefetch" })).toBe(false);
  });
});
