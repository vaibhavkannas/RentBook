# RentBook v1.0 roadmap

Date: 2026-10-14
Status: approved by the owner ("full permission, no questions"); built wave by wave

## Goal

Turn RentBook from a working single-owner tool into a product a stranger can buy, set up, use and trust: reliable, secure, polished, documented, configurable.

## Product model (decision)

**Self-hosted, single-tenant.** Each buyer runs their own copy: their own Vercel project, Google Cloud project, service account and Google Sheet. The buyer's tenant data stays in the buyer's Sheet; the seller holds no data. A multi-tenant SaaS (database, per-customer Google tokens, billing, processor obligations) is a later, separate product and is out of scope for v1.0.

## Sources

Four independent audits on 2026-10-14: UX and accessibility, security, sell-readiness (product and engineering due diligence), reliability and code quality. Their findings are the backlog below.

## Waves

Each wave ships independently: spec/plan, implementation by agents, independent review, tests, a run of `npm run verify:testcopy` against the test copy, then merge and deploy. The owner's live data and behaviour must not change except where a fix says so.

1. **Trust** (correctness, resilience, security). No visual change except error pages.
   - 1A data layer: month cells parsed one by one and unreadable ones reported, plausible-date check, non-destructive concurrent month-row creation (in-process write lock, re-check, read-back), runtime tab errors mapped to clear messages and bootstrap reset, safe first-run seeding (never reseed Settings when other app tabs exist), note rows in Settings ignored, `batchGet` snapshot (one Google read instead of three), explicit timeouts and retries, new error codes (`rate-limited`, `unavailable`) and Google error mapping, hike rounding in integer basis points, Replace-after-duplicate carries the entry the person saw, ids as Map keys, `crypto.randomUUID` tenancy ids.
   - 1B server and security: signed log-retry token and idempotent retry, signed freshness cookie, JSON content-type and same-origin check and body limit, security headers and a nonce CSP, 7-day sessions with a revoke-all switch, `AUTH_SECRET` strength check, explicit `emailVerified`, shared text validators and date ranges, `server-only`, a guard-coverage test, structured error logging with request ids, `/api/health`, error and not-found pages, `robots`, `security.txt`.
2. **App feel.** Brand identity (icon set with maskable, favicon, sign-in page), shared primitives (`Button`, `Field`, `Notice`, `Pill`, bottom `Sheet`), bottom tab bar, loading skeletons, success toasts and pending states, back navigation that keeps the month, press and focus states, safe areas and theme colour, plain-language copy, form validation and timeouts, a better Activity screen, offline shell and refresh control, desktop layout.
3. **Product setup.** A `Config` tab (currency, locale, time zone, app name, accent colour, defaults), no owner-specific defaults, dynamic manifest and icons, `/setup` and `/diagnostics`, "Prepare my Sheet", optional `TOTAL_HEADER`, demo mode on an in-memory gateway, vacancy handling, add / deactivate / reorder portions, a rewritten `SETUP.md`.
4. **Features.** CSV export, printable receipts with a WhatsApp share link, an overdue (arrears) list, a year view with totals per portion, agreement-end and hike-due alerts, a Tenancy Log for tenancy edit history.
5. **Release.** CI (typecheck, lint, test, build, audit), Dependabot, jsdom component tests, route integration tests, Playwright end-to-end tests on demo mode, LICENSE and third-party notices, README as a product page, landlord guide, admin guide, troubleshooting, limits page, changelog, tag v1.0.0.

## Limits that engineering alone cannot remove (to be stated in the docs)

- A Google Sheet is the database: anyone with edit access can change records; the audit trail is evidence, not proof; simultaneous writers are last-writer-wins beyond the protections above.
- Google quotas, API changes, organisation policies that block service-account keys, and Vercel plan terms (the free Hobby plan is for non-commercial use) apply.
- Privacy law, receipt validity, tax and rent-control rules vary by country; the app records data and gives no legal or financial advice.
- Source-level licence enforcement for a self-hosted product is by contract only.
- "No loopholes" is not a guarantee anyone can give; the mitigations are tests, CI, dependency scanning, a written threat model, a vulnerability-reporting policy and an external penetration test before a commercial launch.
