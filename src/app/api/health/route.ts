import pkg from "../../../../package.json";

/**
 * The health check, for an uptime monitor. It is open on purpose (see tests/server/guards.test.ts): it asks nobody
 * who they are, reads no setting and calls no Google service, so it says "up" even when sign-in or the Sheet is not
 * set up. It answers with the version and nothing else.
 */
export async function GET() {
  return Response.json({ ok: true, version: pkg.version });
}
