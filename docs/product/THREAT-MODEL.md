# RentBook threat model

Date: 2026-10-16
Status: first version, for v1.0. Checked against the code when it was written. Not reviewed by an outside tester. The parts about the owner-only pages and routes, the portion routes and the Payments Log header were brought up to date when Set up, Diagnostics and portion management were added.

This is a short, honest account of what RentBook protects, from whom, how, and where it stops. It is not a guarantee. Nobody can promise "no loopholes", and this app has not had an external penetration test.

RentBook is self-hosted and single-tenant (see [ROADMAP-v1.md](ROADMAP-v1.md)). Each owner runs their own copy with their own Vercel project, Google Cloud project, service account and Google Sheet. This model describes one such deployment. The seller holds no tenant data.

To report a weakness, see [SECURITY.md](../../SECURITY.md).

## How it fits together

A phone browser talks to the RentBook server on Vercel. The server signs people in through Google (Auth.js) and reads and writes the owner's Google Sheet through a service account. The Sheet is the only database. The browser code sends its requests to its own server only (apart from the redirect to Google at sign-in) and keeps nothing in browser storage.

## What is worth protecting

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Tenant and payment data: names, phone numbers, advances, rents, notes, who logged what | The owner's Sheet (Schedule, Settings, Tenants and Payments Log tabs). The server also keeps a copy in memory for 15 seconds | It is personal and financial data about other people |
| Service account key (`GOOGLE_SERVICE_ACCOUNT_JSON`) | A Vercel environment variable, `.env.local`, and the downloaded key file until it is deleted | It reads and writes every Sheet shared with that service account. Its scope is `https://www.googleapis.com/auth/spreadsheets` |
| `AUTH_SECRET` | The same places | It encrypts the session cookie and signs the retry token and the freshness cookie. Someone who has it can make a valid session for any address on the allow-list. They still need to know such an address |
| OAuth client secret (`AUTH_GOOGLE_SECRET`) | The same places | On its own it does not let anyone into the app or the Sheet. It lets someone else act as the app's sign-in client at Google |
| The allow-list (`ALLOWED_EMAILS`) | Vercel and `.env.local` | It decides who gets in. Whoever can change it can add themselves |
| The audit trail | The `Payments Log` tab | It is how the owner checks who did what (see the limits below) |

## Who is involved

| Actor | What they can do, and what we assume |
| --- | --- |
| Owner | The first address in `ALLOWED_EMAILS`. Trusted. Can do everything a member can, and can change Portion settings. Usually also owns the Sheet and the cloud accounts |
| Listed member | Any other address in `ALLOWED_EMAILS`. Trusted with all the data: can log, edit and undo payments, change tenancy details and read the Activity screen. Cannot change Portion settings. Their actions carry their address, but they can still enter wrong data |
| Outsider | Anyone else on the internet. Can reach the sign-in page, the error pages, `/api/health`, `robots.txt`, the manifest, the icons, `/.well-known/security.txt` and Auth.js's own routes (`/api/auth/...`). Every other page and API route refuses them. A Google account that is not on the allow-list can complete Google sign-in but is refused by the app |
| Anyone with edit access to the Sheet | Works around the app completely. They can change or delete any cell, and so can the service account |
| A compromised Google account | A listed member's account gives an attacker that member's access. The owner's account gives the owner's. The account that owns the Sheet or the Cloud project gives control of the Sheet or the key, whatever the app does |
| Someone who can deploy to the Vercel project, or a malicious dependency | Can make the app do anything with the secrets it holds. The app cannot defend against its own host or its own code |
| A web page in a member's browser | Another site the member has open, which may try to make their browser send requests to RentBook |

## Trust boundaries

1. Browser to server, over HTTPS. The browser is not trusted. The server checks the allow-list, the owner role and every input again on each request.
2. Server to Google Sheets. Only the server holds the key. The key never goes to the browser.
3. Google sign-in to the app. Google says who someone is. The app decides whether that person may come in, and only accepts an address that Google has marked verified.
4. The Sheet to the app. Anyone with edit access can change the Sheet, so the app treats what it reads as data that may be malformed. It checks the headers of the Schedule and Tenants tabs and the values in Settings, and refuses to work with a tab it cannot read, naming the problem. The Payments Log is the exception: the app only adds rows to it and reads it for the Activity screen. It does not check columns A to G, and when the header row exists but its H1 or I1 is blank it fills that cell with "Logged by" or "Action". A heading already in H1 or I1 is left alone, and rows are still written by column position (`src/lib/sheets/settings-store.ts`). It also reports a Month cell inside the Schedule table that it cannot read as a month. Some bad values are ignored instead: text typed into a number column of the Tenants tab, or an advance status that is not one of the three allowed words.
5. The host. Vercel holds the environment variables and the logs. It is trusted.

## What the code does

Each claim names the file that does it.

### Sign-in and access

- Sign-in is Google only, with no passwords. A session is given only to an address on the allow-list that Google has verified (`src/auth.ts`, `isAllowedEmail` in `src/lib/server/env.ts`). Gmail addresses are compared the way Gmail does, ignoring dots and `+` tags. Other addresses are compared exactly, in lower case.
- The allow-list is checked on every page and every API call, not only at sign-in (`getViewer` in `src/lib/server/auth-guard.ts`). Removing an address from `ALLOWED_EMAILS` and redeploying locks that person out on their next request.
- A session lasts 7 days from the moment of signing in, and no longer, however it is used. The sign-in time (`issuedAt`) is kept inside the encrypted cookie, and `getViewer` refuses a session whose sign-in time is more than 7 days ago, or more than 5 seconds ahead of the server's clock (`isSessionCurrent` in `src/lib/server/session-policy.ts`). The cookie's own 7-day expiry is not enough on its own: Auth.js's `GET /api/auth/session` re-signs the cookie with a fresh expiry and the same sign-in time (`node_modules/@auth/core/lib/actions/session.js`), so anyone holding a copy of the cookie could ask for that again and again and keep it alive for ever. `getViewer` reads the session with `auth()` and no arguments, which does not send a renewed cookie back, so the app's own pages do not extend it. A cookie from before sign-in times were kept has no sign-in time. The `jwt` callback (`src/auth.ts`, `stampIssuedAt`) gives it one the first time Auth.js renews it, and from then on it is capped like any other. One that is never renewed ends with its own cookie's 7 days. While `SESSION_NOT_BEFORE` is set such a cookie is not stamped and is refused. The cookie is an Auth.js JWT, encrypted with a key made from `AUTH_SECRET`. Auth.js sets it HttpOnly, SameSite=Lax, and Secure on https. `SESSION_NOT_BEFORE` signs out everyone who signed in before a given time, and also every cookie that has no sign-in time. An unreadable value signs everyone out. It is the way to cut off every old or copied cookie at once.
- `AUTH_SECRET` must be at least 32 characters, or the app refuses every request that needs a sign-in, with a configuration error that does not show the value (`authSecret` and `assertAuthConfig` in `src/lib/server/env.ts`).
- Only the owner can change settings, add, switch off or reorder portions, or run Prepare my Sheet (`requireOwner` in `src/lib/server/auth-guard.ts`, used by `src/app/api/settings/route.ts`, the three routes under `src/app/api/portions` and `src/app/api/setup/prepare/route.ts`). The settings page sends everyone else to the month screen.
- `/setup` and `/diagnostics` are owner-only and show no secret, key, token or tenant data. They show tab titles, header texts, counts, times and the service account's address (the address the Sheet must be shared with), and they only read, apart from the Prepare my Sheet button, which is the owner-only route above. Anyone else who opens them is told they are for the owner (`src/app/setup/page.tsx`, `src/app/diagnostics/page.tsx`).
- `tests/server/guards.test.ts` reads the source and fails if a page or route does not ask who is signed in, unless it is on a short list of open ones (sign-in, Auth.js, `/api/health`, robots, manifest, icons, not-found). It is a safety net. It reads text, so it is not a proof.

### Requests to the API

- Every route that changes something (`/api/payments`, `/api/payments/undo`, `/api/payments/log-retry`, `/api/settings`, `/api/portions`, `/api/portions/active`, `/api/portions/order`, `/api/setup/prepare`, `/api/tenancies` and `/api/tenancies/move-out`) first calls `readJsonBody` (`src/lib/server/http.ts`), before it asks who is signed in. `/api/health` and Auth.js's routes do not. The request must come from the app's own page: `Sec-Fetch-Site`, when the browser sends it, must be `same-origin`, and `Origin`, when present, must be this host. It must have the content type `application/json`. The body may be at most 32 KB, judged by the announced length and by the bytes that actually arrive. The answers are 403, 415 and 413. A tool that sends neither `Sec-Fetch-Site` nor `Origin` is judged by its content type alone, and still needs a session.
- Every body is checked against a zod schema (`src/lib/server/schemas.ts`). Text a person types that is written to the Sheet (names, phone, notes) is trimmed, length-limited and free of control characters. What the browser sends back from what it was shown is only length-limited, to 200 characters: the seen tenant name of a payment or undo, the `id` and `expectedUpdatedAt` of a tenancy, and the stored name on a tenancy update. Those are compared with the Sheet and never written to it, and they are not trimmed or checked for control characters. Dates must be real `YYYY-MM-DD` days from 2000 to 2100, so a tenancy date before 2000 is refused (`src/lib/server/validators.ts`, `src/lib/domain/input-rules.ts`).
- Writes to Google are `RAW`, so text a person types is never run as a formula (`valueInputOption` in `src/lib/sheets/google-gateway.ts`).
- Auth.js's own routes (`/api/auth/...`) are not checked by `readJsonBody`. They use Auth.js's own CSRF check. The sign-in and sign-out buttons are Server Actions (`src/app/signin/page.tsx`, `src/app/more/page.tsx`). Next compares their `Origin` header with the host and aborts a request that does not match (Next's `data-security` guide, "Allowed origins").

### Signed values

- `src/lib/server/signing.ts` signs with HMAC-SHA256 and `AUTH_SECRET`, and compares in constant time.
- If a payment is saved but its Payments Log row is not, the browser gets a retry token instead of the row (`src/lib/server/retry-token.ts`). The retry route takes the row from the token, never from the request. The token is made for one person, is good for 15 minutes, and the "Logged by" cell is always the person who retries. The retry first looks through the newest 30 log rows for the same entry and adds nothing if it is there. The token is signed, not encrypted: it holds that payment's tenant name and amounts, which the person already saw.
- The `rb-wrote` cookie (`src/lib/server/freshness.ts`) holds a write time and a signature of that time and the person's address. It is HttpOnly, SameSite=Lax, and Secure in production, and counts for 120 seconds. It only lets the person's next page skip the 15-second cache after their own change. A cookie that is not signed for that person, is older than 120 seconds or is more than 5 seconds ahead of the server's clock is ignored.

### Browser hardening

- `next.config.ts` sends these on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off camera, microphone, location, payment, USB and browsing topics, `Strict-Transport-Security` for two years including subdomains, and `X-Robots-Tag: noindex, nofollow`. API answers also carry `Cache-Control: private, no-store, max-age=0`. The `X-Powered-By` header is off. `src/app/robots.ts` disallows every crawler.
- `src/proxy.ts` and `src/lib/server/csp.ts` give each page request a new nonce and a Content-Security-Policy. Scripts run only with the nonce, or when a script that has the nonce loaded them (`'strict-dynamic'`). Style elements need the nonce too. `style-src-attr 'unsafe-inline'` allows inline `style=""` attributes, which React writes for things such as the progress bar. It allows any such attribute, not only React's, and does not allow inline `<style>` elements. Other sources are limited to `'self'` (images may also be `data:` or `blob:`), plus `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`, and `form-action` that also allows `https://accounts.google.com` for sign-in. The proxy does not run for the API, Next's static files, icons, the manifest, `robots.txt`, `/.well-known` or link prefetches. Development builds also allow eval and inline styles.
- `CSP_REPORT_ONLY=1` is the emergency switch. The same policy then goes in `Content-Security-Policy-Report-Only`: the browser blocks nothing and only reports. The app has no `report-uri`, so nobody collects the reports. They show only in the browser console. Any other value enforces. The switch is described in `SETUP.md`.
- The nonce needs every page to render for its own request. `getViewer()` calls `connection()` for this, and so does `src/app/not-found.tsx`, so none of our pages is built ahead of time or served from a static copy. Without it a page would carry no nonce and its scripts would be blocked. Next still builds its own `/_global-error` page ahead of time. It carries no nonce, so the policy blocks its scripts (see the comment in `src/app/global-error.tsx`).

### Secrets and server code

- `import "server-only"` starts `src/auth.ts`, every file in `src/lib/server` and `src/lib/sheets/google-gateway.ts`. A build that lets browser code import them fails (`tests/server/server-only.test.ts` checks the marker). Because of this, scripts run with `tsx` (`npm run recon`, `npm run verify:testcopy`) need `--conditions=react-server`, which `package.json` already sets. Without it the marker throws.
- A key that cannot be parsed is reported without quoting it (`fromServiceAccount` in `src/lib/sheets/google-gateway.ts`).
- Only the owner is shown what is wrong with the connection to the Sheet (the key, the sharing, `SHEET_ID`). Everyone else reads "The Sheet connection needs attention. Ask the owner." (`messageFor` in `src/lib/errors.ts`). In an API answer, an error the app did not expect reaches the browser as "Something went wrong on our side. Try again." and a request id.

### Keeping data consistent

- One write at a time in a server process (`src/lib/sheets/write-lock.ts`), for payments, undo, the log retry, tenant details and move-out. Adding, switching off or reordering a portion (`src/lib/sheets/portion-service.ts`) and Prepare my Sheet take it too: each reads the Sheet fresh, writes `RAW`, reads back what it wrote, and never deletes or overwrites a cell that holds something. Saving Portion settings (`saveSettings` in `src/lib/sheets/service.ts`) takes it too, because it writes by the Settings row a reorder may move. Only the owner can do that.
- A change carries what the person saw (`expected` for payments and undo, `expectedUpdatedAt` for tenant details). If the Sheet no longer matches, the change is refused as a conflict. Undo and tenant edits require it. For a payment it is optional (`paymentBody` in `src/lib/server/schemas.ts`): the app's own screens send it when they replace an entry, and a direct API caller need not, in which case a Replace is not compared with what was there.
- After a Schedule write the app reads the row back and refuses if it does not hold what was written (`confirmWritten` in `src/lib/sheets/service.ts`). If the read-back itself fails, it logs that the change was written but not verified and carries on.

### Logs

- Every line that RentBook's own code writes to the server log is one JSON line from `logEvent` (`src/lib/server/log.ts`): time, level, event, request id, route without its query string, error code, a message of at most 500 characters and the signed-in person's address in lower case. ESLint refuses any use of the console in `src` outside that file (`eslint.config.mjs`, run by `npm run lint` and in CI), and `tests/server/no-console-rule.test.ts` checks the rule against the ways round it, such as `const { error } = console` and `process.stderr.write`. The line is built field by field, so a field outside that list is dropped, and so is a listed field that is not text. The text in `message` is logged as given, up to 500 characters. Keeping names and numbers out of it is the caller's job. Auth.js's own logging goes through it too (`authLogger` in `src/lib/server/auth-log.ts`, the `logger` option in `src/auth.ts`): Auth.js's default would print the stack, the cause and the details of an error, which can include a sign-in provider's reply, so an Auth.js error or warning becomes one line with only its kind or warning code, and its debug output is discarded. Next.js still prints some of its own errors to the console in its own format, outside the logger.
- The events are `api-error` (a failed API request, in `handle` in `src/lib/server/http.ts`) and `request-error` (an error nothing caught, in `src/instrumentation.ts`); `payments-log-append-failed` (one line for each failed try to add a Payments Log row, up to three; a failed try does not prove the row is missing, because a timeout or a lost answer can come back after the row was added) and `payments-log-check-failed` (the retry could not read the log to look for the row, so it added nothing); `read-back-failed` (a change was written but could not be read back to verify); `tenancy-write-failed` (the payment was saved but the tenancy details were not); `sheet-connection-problem` and `page-load-failed` (a page could not read the Sheet; `src/lib/server/problem.ts`); `freshness-cookie-not-set` (`src/lib/server/freshness.ts`); and `session-not-before-unreadable` (`src/lib/server/session-policy.ts`); and `auth-error` and `auth-warning` (Auth.js, level warn; `src/lib/server/auth-log.ts`). A page that shows a Google limit, Google not responding or a problem with the Sheet's structure to the person writes no line.
- RentBook's own code logs a failure from its code and its message, never by printing the error object, because a library's error can carry the request it made, headers included. `describeError` puts an unexpected error's own message straight into the line (`src/lib/server/http.ts`, `src/instrumentation.ts`), and `errorLogFields` does the same for the failures that the Sheets service, the pages and the freshness cookie handle themselves. A conflict's text can name a tenant, so for that reason only its code and a fixed sentence are logged (`messageForLog`). The signed-in person's address is only on the `api-error` line of a connection (config) error.
- The request id is the `x-vercel-id` header when it is plain characters and at most 200 long, otherwise a new UUID. The same id is in the body of the error answer, so a report of "it failed" can be found in the log. Only the `api-error` and `request-error` lines carry one: the other events are written by code that is not given the request.
- Apart from a conflict, the message text is what the error itself said, and Next.js prints some errors itself, so treat the Vercel logs as sensitive, and do not paste them into a public issue.

### Health check and error pages

- `GET /api/health` is open on purpose. It answers `{ ok: true, version }` and nothing else. It reads no setting and does not call Google, so it says "up" even when sign-in or the Sheet is not set up. It says nothing about whether the Sheet works. Anyone can read the version.
- `src/app/error.tsx`, `src/app/global-error.tsx` and `src/app/not-found.tsx` say "Something went wrong on our side" or "That page was not found", and show nothing about the error. Their recovery is a link or a retry. For a failure outside React rendering Next shows its own built-in static 500 page instead. In a build here it reads "500: This page couldn't load", with none of our wording.

## Limits that remain

- The Sheet is the database. Anyone with edit access, and the service account, can change or delete any record, including the Payments Log, without the app being involved. The checks above notice some changes. They do not prevent them. Google's Sheet version history is the better record of what changed.
- Writers can collide. The write lock covers one server process. Vercel can run several, and a person can type into the Sheet at the same time. The conflict check and the read-back narrow the gap and do not close it. Beyond them it is last writer wins.
- The audit trail is evidence, not proof. "Logged by" is the Google address that signed in, so a shared account hides who really acted. A log row can fail to save after the payment did, and the retry can add a duplicate if more than 30 newer rows were logged in between. Anyone with edit access can change or delete rows.
- A session cannot be revoked on its own, because it is a JWT held in the browser and the server keeps no list of sessions. The Sign out button on the More screen (`src/app/more/page.tsx`) clears the cookie in that browser only. A copied cookie stays valid until 7 days after sign-in (renewing it does not move that day, see above), the address is removed from `ALLOWED_EMAILS`, `SESSION_NOT_BEFORE` is set, or `AUTH_SECRET` is replaced. Removing an address and setting `SESSION_NOT_BEFORE` are environment variables, so each takes effect when the app is redeployed. `SESSION_NOT_BEFORE` is the way to cut off every old cookie at once. Someone holding a member's unlocked phone has that member's access in the same way.
- The app has no rate limiting of its own. It assumes the host (Vercel) adds some protection against floods of requests. That is the host's feature, and this repository neither sets it up nor tests it. Google's quotas also cap how much the app can do. A signed-in person can use up the Google quota and make the app slow or unavailable for everyone (the app then says Google is limiting requests).
- Everyone on the allow-list sees every tenant's details. There are no per-portion permissions. The Sheet holds the data in plain text, protected only by Google.
- Tenancy dates before 2000 or after 2100 are refused in the forms. A date typed straight into the Tenants tab is read as it is.
- Auth.js v5 (`next-auth` 5.0.0-beta.32) is still a beta release.
- Dependency checks exist in the repository: `npm audit --omit=dev --audit-level=high` in `.github/workflows/ci.yml`, and weekly Dependabot updates in `.github/dependabot.yml`. They have not been checked in the GitHub settings. They catch known problems in dependencies, not unknown ones.
- Privacy law, receipt validity, tax and rent-control rules differ by country. The app records data and gives no legal or financial advice.

## Before a commercial launch

- [ ] An external penetration test of a deployed copy, and the findings fixed.
- [ ] Dependency scanning confirmed on in GitHub (Dependabot alerts and secret scanning), the audit level in CI reviewed, and a named person who reads the results.
- [ ] Key rotation practised once on a test copy: service account key every 90 days (see `SETUP.md`), plus a written plan for `AUTH_SECRET` and the OAuth client secret.
- [ ] Private vulnerability reporting switched on for the GitHub repository, so the link in `SECURITY.md` and `security.txt` works. Test it with a report of your own.
- [ ] 2-Step Verification confirmed on every listed Google account, and on the GitHub and Vercel accounts that can change the code or the secrets.
- [ ] Preview deployments confirmed to use the test Sheet and a separate service account, never the live key.
- [ ] A decision on log retention, and on who can read the Vercel logs.
- [ ] A decision on rate limiting.
- [ ] The `Expires` date in `public/.well-known/security.txt` renewed (2027-10-16 now), once a year.
- [ ] Privacy, receipt and tax rules reviewed for each country the app is sold in.
- [ ] This model read again after any large change, and updated.
