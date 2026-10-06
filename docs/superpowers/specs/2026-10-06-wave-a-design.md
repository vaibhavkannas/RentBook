# RentBook enhancements, wave A

Date: 2026-10-06
Status: approved by the owner; implemented per docs/superpowers/plans/2026-10-06-wave-a-implementation.md

## Purpose

RentBook version 1 is live and in daily use. The owner asked for five enhancements. This spec covers wave A: faster, clearer month switching, undoing a mistaken entry, more people using the app, and an audit trail of who did what. Waves B and C are listed at the end so the choices here fit them.

## Scope

In scope:

1. Month switching: instant feedback, faster loads, easier navigation.
2. Undo a logged payment.
3. Several people can sign in and log. The first listed person is the owner.
4. A "Logged by" record and an Activity screen.

Out of scope for wave A:

- Tenant details, advances, agreement dates (wave B).
- Year view, CSV export, agreement-end and hike-due alerts (wave C).
- A way to correct a payment count or tenant in place. Undo and log again covers a wrong tenant or portion. A separate "fix count" is not built unless the owner needs it.
- Roles beyond owner and member, view-only users, tenant logins.
- WhatsApp sharing and a pending list. The owner did not approve them.

## Users and access

Sign-in accepts a list of Google accounts. The owner plus three more accounts are expected at launch. The addresses live only in environment configuration and the Google Cloud test-user list, never in the repository.

- New variable `ALLOWED_EMAILS`: addresses separated by commas, spaces or semicolons, compared case-insensitively. The first address is the owner.
- `ALLOWED_EMAIL` still works when `ALLOWED_EMAILS` is not set, so the first deploy of this change breaks nothing. When both are set, `ALLOWED_EMAILS` wins and `ALLOWED_EMAIL` is ignored.
- The Google-verified email check stays. Every request still re-checks the signed-in address against the list, so removing an address locks that person out on their next request even if their session is still valid.
- Everyone on the list can log, edit and undo payments and read the Activity screen.
- Only the owner can open Portion settings or call the settings API. A wrong cycle length or hike percent corrupts later counts and suggestions, so it stays with the owner. Other people do not see the link.
- Each extra person is added as a Test user in Google Cloud. They need no access to the Sheet itself, because the app writes as the service account. While the OAuth app is in Testing, each person sees Google's "unverified app" warning at sign-in.
- The home footer shows who is signed in.

## Month switching

Today every tap on an arrow is a full server render that re-reads the Settings tab and then the whole schedule from Google, one after the other. Nothing changes on screen except the title, and only after the data arrives.

Changes:

- **Instant feedback.** The month title changes to the target month as soon as the control is tapped. The summary and portion cards dim and show a loading state until the new data arrives. The previous and next controls stay usable, and the latest tap wins.
- **Fewer round trips.** The Settings and schedule reads run in parallel.
- **Short cache.** The parsed schedule and settings are cached on the server for about 15 seconds. Every write (log, edit, undo, save settings) clears the cache first, so the person who wrote sees their own change at once. Other people see a change within the cache window. Writes never use the cache: logging and undo always read fresh data before deciding anything. The caching mechanism is chosen in the implementation plan after reading the Next.js 16 documentation in `node_modules/next/dist/docs/`.
- **Today pill.** A "Today" control appears whenever the shown month is not the current month in India time, and returns to the current month.
- **Month picker.** Tapping the month title opens a picker: a year header with previous and next year controls and twelve month buttons, with the current and shown months marked.
- **Swipe.** A horizontal swipe on the page body moves to the next or previous month. A swipe is ignored when it starts inside an open dialog, when it is mostly vertical, or when it is shorter than a set distance.

The month picker's month list and the swipe decision are pure functions, so they are unit tested.

## Undo

A paid card shows **Edit amount** and a quieter **Undo**. Undo opens a confirmation sheet that says what will happen, for example: "Undo the ₹10,835 payment from the tenant for October 2026? This clears the tenant, count and amount for this portion in October. The Payments Log keeps a record." The sheet has **Undo payment** and **Keep**. After a successful undo the card returns to its pending state and a short confirmation message appears.

Rules, checked on the server against fresh data:

1. The month row must exist and the portion must have a complete entry in it. Otherwise: "Nothing to undo."
2. The request carries the tenant, count and amount the person saw. If the stored entry differs, the app refuses with a conflict and the screen reloads, so a stale screen cannot undo someone else's newer change.
3. Undo is allowed only for the portion's latest entry: no later month row may have an entry for that portion. Next month's count and suggested amount are derived from the prior entry, so removing a middle entry would corrupt them. If a later entry exists, the card explains that later months must be undone first.

What undo writes:

- The portion's tenant, count and amount cells in that month row are cleared. Writes stay RAW.
- If the total cell is typed rather than a formula, it is rewritten as the sum of the other portions' amounts, as logging does. A formula total is left alone.
- A row is appended to the Payments Log with action `Undone`, the entry that was cleared, and who did it. If the log row fails, the same retry path as logging is used, and the screen says the log entry did not save.
- The month row itself stays. An undone first payment of a tenant returns the portion to its previous state, which may be "No tenant".

Route: `POST /api/payments/undo`.

**Edit amount follows the same stale-screen rule.** The edit request carries the tenant, count and amount that were on the card when the sheet opened (`expected` on `POST /api/payments`). If the stored entry is missing or differs, for example because someone else undid or changed it, the app refuses with a conflict, writes nothing, and the screen reloads. Without this, an edit of an undone payment would recreate it under the portion's previous tenant. A confirmed "Replace amount" after a duplicate warning, and the service-level overwrite of an incomplete cell, do not carry an expected entry.

## Logged by and the Activity screen

The Payments Log gets two columns, appended after the existing seven: `Logged by` (the signed-in email) and `Action` (`Logged`, `Edited` or `Undone`). Existing rows keep blank values there and show as "—" in the app.

- `logPayment` takes the signed-in email and writes it. An overwrite of an existing amount records `Edited`. Everything else records `Logged`.
- The log row type grows from 7 to 9 values, and the retry request schema is updated to match.
- On start-up the app checks the Payments Log header row. If `Logged by` and `Action` are missing it writes them into columns H and I. The check is idempotent and runs once per server instance.
- A new `/activity` page, linked from the footer for everyone, lists the latest 50 Payments Log rows, newest first: when (India time), who, action, portion, month, tenant, amount and count. It has an empty state and the same error handling as the home page.

## Data and API changes

- Schedule tab: no change in layout.
- Payments Log tab: columns H and I added as above.
- New route `POST /api/payments/undo`. `POST /api/payments` and `POST /api/payments/log-retry` accept the longer log row.
- `/api/settings` and `/settings` require the owner.
- New page `/activity`.
- `requireUser` returns the signed-in email, as it already does. A second guard, `requireOwner`, wraps it.

## Error handling

- Unknown or missing month row, missing entry, stale entry, or a later entry: clear messages, no writes.
- A failed Google call: the existing generic message, nothing half-written. Undo writes its three cell clears (and a typed total) in one `batchUpdate`, as logging does.
- A signed-in person who is not on the list sees the existing "isn't allowed" screen.
- A non-owner who opens `/settings` is redirected home.

## Testing

All service logic is tested against the in-memory fake gateway, in the style of the existing 171 tests.

- Allow-list parsing, owner detection and the `ALLOWED_EMAIL` fallback.
- Undo: formula total, typed total, no entry, stale entry, later entry blocks, first payment of a tenant, and log row written, log row failed with retry.
- `logPayment` records `Logged by` and the right `Action`.
- Header migration adds the two columns once and leaves existing rows alone.
- Activity parsing: blank new columns, newest-first order, the 50-row limit.
- Route tests for the new and changed routes: unauthenticated, not on the list, non-owner on settings.
- Pure helpers: month picker list, swipe decision.
- Manual check on a phone: loading state, swipe, picker, Today, undo, a second account signing in.

## Rollout

1. Merge and deploy. The code reads `ALLOWED_EMAIL` until `ALLOWED_EMAILS` exists, so nothing changes for the owner.
2. In Google Cloud, add each extra account as a Test user.
3. In Vercel, set `ALLOWED_EMAILS` with the owner first, then redeploy.
4. Each person signs in once and accepts the unverified-app warning.
5. Confirm on the real Sheet that the Payments Log header gained the two columns, then log and undo one test entry on the test copy first.

## Decisions made on the owner's behalf

These were chosen for the best phone experience and can be changed in review:

- Everyone can log, edit and undo. Only the owner manages Portion settings.
- No separate fix-count feature.
- A cache of about 15 seconds, with writes clearing it.
- Identity in the log is the Google email, not a display name.
- The Activity screen shows 50 rows with no paging.

## Later waves

- **Wave B:** a `Tenants` tab and a tenant details screen: move-in date, advance, agreement end, phone, notes, status and move-out with the advance refund. The New tenant flow asks for the advance and move-in date.
- **Wave C:** a year view with totals per portion, a CSV export, and agreement-end and hike-due alerts using wave B's dates.
