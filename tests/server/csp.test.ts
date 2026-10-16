import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, generateNonce } from "@/lib/server/csp";

const NONCE = "bm9uY2UtZm9yLXRoZS10ZXN0";

/** The policy as a map of directive name to its sources, so a test reads one directive at a time. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );
}

describe("buildCsp", () => {
  it("is the production policy, directive by directive", () => {
    expect(buildCsp({ nonce: NONCE, dev: false })).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${NONCE}'`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://accounts.google.com",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("is one line, with no trailing separator", () => {
    const policy = buildCsp({ nonce: NONCE, dev: false });
    expect(policy).not.toMatch(/[\r\n]/);
    expect(policy).not.toMatch(/;\s*$/);
    expect(policy).not.toMatch(/\s{2,}/);
  });

  it("allows eval and inline styles only in development", () => {
    const dev = directives(buildCsp({ nonce: NONCE, dev: true }));
    expect(dev.get("script-src")).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'", "'unsafe-eval'"]);
    // A nonce next to 'unsafe-inline' would switch the inline allowance off, so development has no nonce here.
    expect(dev.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);

    const prod = directives(buildCsp({ nonce: NONCE, dev: false }));
    expect(prod.get("script-src")).not.toContain("'unsafe-eval'");
    expect(prod.get("style-src")).not.toContain("'unsafe-inline'");
  });

  it("is the same in development and production apart from script-src and style-src", () => {
    const dev = directives(buildCsp({ nonce: NONCE, dev: true }));
    const prod = directives(buildCsp({ nonce: NONCE, dev: false }));
    for (const name of prod.keys()) {
      if (name === "script-src" || name === "style-src") continue;
      expect(dev.get(name)).toEqual(prod.get(name));
    }
    expect([...dev.keys()]).toEqual([...prod.keys()]);
  });

  it("never allows inline or eval scripts in production, nor an open source", () => {
    const policy = buildCsp({ nonce: NONCE, dev: false });
    expect(directives(policy).get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/(^|[ ;])\*/);
    expect(policy).not.toContain("http:");
  });

  it("carries the nonce it is given, and only that one", () => {
    const a = buildCsp({ nonce: "AAAA", dev: false });
    const b = buildCsp({ nonce: "BBBB", dev: false });
    expect(a).toContain("'nonce-AAAA'");
    expect(a).not.toContain("BBBB");
    expect(b).toContain("'nonce-BBBB'");
    expect(a.replaceAll("AAAA", "BBBB")).toBe(b);
  });
});

describe("cspHeaderName", () => {
  it("is the enforcing header by default", () => {
    expect(cspHeaderName({})).toBe("Content-Security-Policy");
    expect(cspHeaderName({ CSP_REPORT_ONLY: undefined })).toBe("Content-Security-Policy");
    expect(cspHeaderName({ CSP_REPORT_ONLY: "" })).toBe("Content-Security-Policy");
  });

  it("is the report-only header when CSP_REPORT_ONLY is 1", () => {
    expect(cspHeaderName({ CSP_REPORT_ONLY: "1" })).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName({ CSP_REPORT_ONLY: " 1 " })).toBe("Content-Security-Policy-Report-Only");
  });

  it("keeps enforcing for any other value, so a typo cannot switch the policy off", () => {
    for (const value of ["0", "true", "yes", "on", "11"]) {
      expect(cspHeaderName({ CSP_REPORT_ONLY: value })).toBe("Content-Security-Policy");
    }
  });
});

describe("generateNonce", () => {
  it("is base64 of a random UUID", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(nonce, "base64").toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is different every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
  });

  it("can sit inside a header and inside a CSP source without escaping", () => {
    const nonce = generateNonce();
    expect(nonce).not.toMatch(/['\s;,]/);
  });
});
