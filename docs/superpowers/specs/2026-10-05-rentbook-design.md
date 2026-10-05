# RentBook design

Date: 2026-10-05
Status: draft, awaiting owner review

## Purpose

RentBook is a phone-first web app for recording monthly rent receipts for one building with five rentable portions. The owner enters each payment in a clean UI. The app writes it into the owner's existing Google Sheet (a native Google Sheet, not an uploaded `.xlsx`). The Sheet remains the single source of truth.

## Goals

- Log a rent payment for one portion in a few taps on a phone.
- Keep the existing Schedule layout in the Google Sheet unchanged.
- Apply the owner's rent-cycle rules automatically (payment count, cycle wrap, suggested 5% hike), with per-portion configuration.
- Keep the original date each rent was received, which the Schedule tab has no column for.
- Make later enhancements cheap: rules, portions, and column mapping come from config, not hard-coded layout.

## Non-goals (first version)

- Multi-user access, tenant logins, or tenant-facing views.
- Receipts or PDF generation, reminders, notifications.
- Importing or migrating historical data.
- Expense tracking.

Enhancements will be requested after the owner tests version 1.

## The Sheet today

The Schedule tab has one row per month. Columns, left to right:

1. `Month`
2. For each of five portions, three columns: `Tenant`, `Count`, `Amount`
3. A total rental income column for the month (header partly cut off in the owner's photo)

Portions: first floor single bedroom, first floor double bedroom, second floor single bedroom, second floor double bedroom, third floor hall and kitchen.

Rules stated by the owner:

- `Count` is the payment number within the tenant's current cycle. A new tenant starts at 1.
- By default the cycle is 11 payments. After payment 11 the next payment is 1 and the rent rises 5% from that payment.
- Cycle length varies per tenant, and for some tenants the count never resets. This must be configurable.
- The 5% hike is a suggestion only. The owner can edit the amount (existing rents appear rounded, so the hike is not an exact formula).
- A vacant portion leaves its three cells blank.

## Data model

The Google Sheet is the only datastore.

**Schedule tab (existing, layout untouched).** The app writes only the three cells for the portion being logged and appends a month row if one does not exist. It never rewrites a whole row and never changes formatting or other columns.

**Derived state.** For each portion, the latest filled row gives current tenant, last count, and last amount. Next count is last count + 1, wrapping to 1 after that portion's cycle length. A wrap flags the next payment as the start of a new cycle and triggers the hike suggestion.

**Settings tab (new, created by the app on first run).** One row per portion: display name, column position of its Tenant/Count/Amount triple, cycle length (blank means never resets), hike percent (default 5).

**Payments Log tab (new, created by the app on first run).** One row per saved payment: saved-at timestamp, month, portion, tenant, amount, count, date received.

**Total column.** Unverified. If it is a formula in existing rows, the app must extend that formula to new rows. If it is a plain value, the app writes the sum. Decided after inspecting the real Sheet.

**Month cell.** Unverified whether it holds a real date or text such as `Oct-26`. The app must write the same type and format the existing rows use.

## Features

1. Month overview: previous/next month navigation, a received-versus-expected summary, and one card per portion showing tenant, payment count, rent, and Paid/Pending state.
2. Log payment: amount (prefilled), date received (defaults to today). Count is automatic and shown, not typed.
3. New-cycle first payment: amount prefilled with the hike suggestion, with a "keep old rent" action.
4. New tenant: enter a name, count restarts at 1, owner types the rent.
5. Vacant portion: cells stay blank.
6. Settings page: edit portion names, cycle length, hike percent.
7. Overwrite protection: logging a portion that already has an amount for that month asks for confirmation first.

UI follows the approved phone mockups (month overview, log-payment sheet, new-cycle prefill).

## Architecture

- Next.js (App Router), TypeScript, Tailwind. Mobile first. Installable as a home-screen app via a PWA manifest.
- `rent-rules` module: pure functions, no I/O. Next count, cycle wrap, hike suggestion, month total.
- Sheet layer: one thin module that reads Schedule and Settings, maps each portion to its columns, and writes single cells. It is the only code that talks to Google.
- Server endpoints, all behind sign-in: get month state, log payment, add new tenant, read/update settings.
- UI components: `MonthPage`, `PortionCard`, `LogPaymentSheet`, `NewTenantSheet`, `SettingsPage`.
- Auth: Google sign-in through Auth.js. Access is restricted to one email (`ALLOWED_EMAIL`).
- Secrets: Google service account key and Sheet ID are Vercel environment variables, never committed.
- Sheet access: a Google service account, with the Sheet shared to the service account email.

## Data flow

Open app -> server reads Schedule and Settings -> `rent-rules` computes each portion's state for the selected month -> cards render.

Save -> server re-reads that portion's latest row (guards against a stale screen) -> validates -> writes the three Schedule cells -> appends the Payments Log row -> returns fresh state.

## Error handling

- Save fails (network, Sheets quota): the card stays Pending, an inline message offers Retry. Nothing is half-written. Schedule cells are written first, then the Log row. If only the Log row fails, the app reports "Saved, log entry pending" and retries the log write.
- Sheet structure changed (expected header not found, column moved): writes stop and the app names the header it could not find. It never guesses.
- Duplicate payment: confirmation before overwrite.
- Not signed in or wrong email: redirect to sign-in, or a plain "not allowed" page.

## Testing

- Unit tests (Vitest) for `rent-rules`: wrap at 11, never-reset, per-portion cycle length, hike suggestion, new-tenant restart, month total.
- Sheet layer tested against a fake in-memory sheet: missing month row, vacant portion, column mapping, total handling.
- Manual end-to-end pass on a copy of the owner's real Sheet. The app is not pointed at the live Sheet until the owner approves.

## Deployment

GitHub repo `vaibhavkannas/RentBook` connected to Vercel, auto-deploying from `main`. The owner does one-time setup: Google Cloud project, Sheets API enabled, service account, OAuth client for sign-in, environment variables. A `SETUP.md` will give exact steps.

## Open items (need the real Sheet)

- ~~Sheet URL~~: received 2026-10-05. The Sheet ID is configuration (`SHEET_ID`) and is deliberately not recorded in the repo. Still needed: the Schedule tab name.
- Whether Month is a date or text, and its exact format. The app handles both; the read-only `npm run recon` check reports which it is.
- Whether the total column is a formula, and its exact header. The app handles both; the header text is required configuration (`TOTAL_HEADER`) because the owner's photo cut it off.
- Exact header names of all columns, to confirm the portion-to-column mapping. `npm run recon` reports them.
- Whether the owner is comfortable with the app adding the `Settings` and `Payments Log` tabs to this workbook.

## Notes added during planning (2026-10-05)

- The first link the owner shared carried `rtpof=true&sd=true`, which marks an uploaded `.xlsx` opened in Google Sheets' Office compatibility mode. The Sheets API cannot write to such files. The owner then shared a second link that looks like a converted native Sheet; `npm run recon` will confirm. Conversion (File, Save as Google Sheets) is a documented prerequisite.
- Configuration added beyond the spec: `SCHEDULE_TAB` (default `Schedule`) and `TOTAL_HEADER` (required).
- "Current month" and the default date received use the `Asia/Kolkata` time zone, because the server runs in UTC.
- Creating a new month row is a single atomic Google `batchUpdate` (copy the last month row, blank the payment cells, set the Month cell). It refuses to run when the row under the table is not empty.
- Implementation plan: `docs/superpowers/plans/2026-10-05-rentbook-implementation.md`.
