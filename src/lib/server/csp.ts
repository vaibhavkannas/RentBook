// The Content-Security-Policy, built as plain text from a nonce. src/proxy.ts sets it on every page request.
// It imports nothing, so it runs wherever the proxy does.

/**
 * A new nonce: base64 of a random UUID. A script or style tag carrying it is allowed to run, so it must be
 * unpredictable and used for one request only.
 */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * The policy for one request. Scripts run only when they carry the nonce, or were loaded by a script that does
 * ('strict-dynamic'). Styles need the nonce too, except the style="" attributes React writes (the progress bar).
 * Development also allows eval (React's debugging) and inline styles (hot reload); with 'unsafe-inline' the
 * style nonce is left out, because a nonce would switch 'unsafe-inline' off.
 */
export function buildCsp({ nonce, dev }: { nonce: string; dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
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
  ].join("; ");
}

/**
 * The header the policy goes in. CSP_REPORT_ONLY=1 is the emergency switch: the browser then only reports what the
 * policy would have blocked, and blocks nothing. Any other value, or none, enforces.
 */
export function cspHeaderName(env: Record<string, string | undefined>): string {
  return env.CSP_REPORT_ONLY?.trim() === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}
