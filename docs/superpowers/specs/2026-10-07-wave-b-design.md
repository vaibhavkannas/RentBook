# RentBook enhancements, wave B: tenancy details

Date: 2026-10-07
Status: approved; implemented per docs/superpowers/plans/2026-10-07-wave-b-implementation.md

## Purpose

The owner used to record advance amounts and other tenancy details as comments on Schedule cells. That is hard to find, impossible to filter, and not available in the app. Wave B stores those details properly, shows the important ones on each portion's card, and keeps a history of past tenants per portion. Wave C (year view, CSV export, agreement-end and hike-due alerts) builds on the dates stored here.

## Scope

In scope:

1. A `Tenants` tab in the same Google Sheet, created by the app, holding one row per tenancy.
2. A tenant details page per portion: current tenant, edit, move out, past tenants.
3. Optional tenancy fields in the existing New tenant flow.
4. Small chips on each portion's card (advance and agreement end) and an "Add details" link when a current tenant has no details yet.

Out of scope:

- Alerts and reminders (wave C).
- Editing a past tenancy inside the app. Past rows can be edited in the Sheet.
- Tenant logins, documents or photos, ID proof numbers, meter readings.
- Any change to the Schedule tab layout or to how counts and amounts are computed.
- Changing who may sign in or the owner rules from wave A.

## Data model

The Sheet stays the only datastore. The app creates a `Tenants` tab on first load if it is missing. Writes are RAW, so nothing typed into a field can turn into a formula. Dates are stored as `YYYY-MM-DD` text, amounts as numbers.

Columns, left to right:

| Col | Header | Meaning |
| --- | --- | --- |
| A | `Tenancy ID` | Stable key made by the app, for example `t-lq3k9x2a`. Never edited by hand. |
| B | `Portion` | The portion id from the Settings tab, for example `p1`. |
| C | `Tenant` | Tenant name as written in the Schedule. |
| D | `Phone` | Free text, at most 30 characters, no line breaks or other control characters. |
| E | `Move-in date` | `YYYY-MM-DD`. |
| F | `Agreement end` | `YYYY-MM-DD`, optional. |
| G | `Advance` | Whole rupees, 0 or more. |
| H | `Advance date` | `YYYY-MM-DD`, optional. |
| I | `Advance status` | `Held`, `Refunded` or `Adjusted`. Blank when there is no advance. |
| J | `Refund` | Whole rupees returned at move-out. |
| K | `Deductions` | Whole rupees kept at move-out. |
| L | `Notes` | Free text, at most 500 characters. |
| M | `Move-out date` | `YYYY-MM-DD`. Blank while the tenancy is current. |
| N | `Updated by` | Email of the last person to change the row. |
| O | `Updated at` | ISO timestamp of the last change. Also used to detect a stale screen. |

Rules:

- A portion's **current tenancy** is the last row for that portion with a blank move-out date.
- A current tenancy is shown on a card only when its tenant name equals, ignoring case and surrounding spaces, the tenant name the card shows from the Schedule. Otherwise the card treats the tenant as having no details yet. This stops stale details from appearing under a new tenant.
- The headers must be exactly the fifteen above, in columns A to O, in that order (spaces around a header do not matter). Columns to the right of O may be added by hand and are ignored. The headers are checked every time the tab is read. A missing or different header does not stop the app: the tenant details pages show a message naming the header, everything else keeps working, and nothing is written to the tab until the header is put back. The app never rewrites or deletes rows it did not touch.
- Hand-edited cells are read forgivingly. Spaces around the `Portion` value and around the date cells are ignored, so a `Move-out date` that holds only spaces still counts as blank (the tenancy is current). A number typed into a date cell becomes a date. Text typed into a number or status column is ignored when reading, and left as it is when saving.

## Screens

### Portion card (home)

- The tenant line gets a small **Details** link to `/tenants/<portionId>`.
- Under it, short chips when details exist: `Advance ₹ 20,000 held`, `Advance returned`, `Agreement ends 15 Mar 2027`.
- When the card has a current tenant but no matching tenancy: an **Add details** link instead of chips.
- A portion with no tenant shows nothing new.

### Tenant details page `/tenants/<portionId>`

Reachable by anyone on the allow-list. Layout from top to bottom:

1. A back link, the portion name, and the current tenant's name.
2. **Current tenancy**: phone, move-in date, agreement end, advance (amount, date, status), notes. An **Edit** button turns the section into a form with **Save** and **Cancel**. When there is no tenancy yet the section is a form headed "Add details".
3. **Move out**: a button that opens a short form: move-out date (default today), advance outcome (Refunded, Adjusted or Held), refund, deductions, notes. Saving closes the tenancy. The Schedule is not changed; the card then shows the portion with its last tenant until a New tenant is logged.
4. **Past tenants**: a read-only list, newest first: name, move-in and move-out dates, advance outcome.

Errors use the same pattern as the rest of the app: a short message, nothing half-saved, and a Try again action for read failures. After a conflict the page shows a notice at the top (see Error handling).

### New tenant flow

The existing sheet gains a collapsed section "Tenancy details (optional)" with: move-in date (default today), advance, advance date, agreement end, phone. Nothing in it is required. If any field is filled the app creates the tenancy at the same time as the first payment. In every case the previous current tenancy of that portion, if it has no move-out date, is closed with move-out date equal to the new move-in date (or today).

## Server behaviour

- The Tenants tab is read together with Settings and the Schedule in the same parallel read, and is part of the 15-second snapshot cache and its invalidation. Every write clears the cache.
- A wrong Tenants header does not fail that read. The snapshot then has no tenancies and carries what is wrong as a message (`tenantsProblem`). The month screen, rent logging, undo, Activity and Settings work as before; the cards show no tenancy chips; the tenant details page shows the message.
- `saveTenancy`: creates a row (new id) or updates one by id. An update carries the `Updated at` value the person saw; if the stored value differs the app refuses with a conflict and the screen reloads. Validation: dates real, move-in not after agreement end or move-out, amounts whole numbers from 0 to 10,000,000, text lengths as above, the portion must exist. When the Tenants tab has a wrong header it refuses with that message before anything is written.
- An update writes only the columns whose value the person changed, plus `Updated by` and `Updated at`, in one `updateValues` call. Text typed by hand into any other cell of the row stays as it is. The status follows the advance only when the advance is added (it starts as `Held`) or removed (the status is cleared).
- `moveOut`: sets move-out date, advance status, refund, deductions and notes on the current tenancy, with the same stale-screen check. Refused when the tenancy already has a move-out date, and refused with the header message when the Tenants tab has a wrong header. It writes only the cells the person gave.
- Creating a tenancy appends the new row first, and only then closes the portion's previous open tenancy. The previous row is found again by its id after the append, so a row that moved in the meantime is not closed by mistake.
- `logPayment` accepts optional tenancy details for the New tenant flow, writes the Schedule cells and the Payments Log row as today, and then writes the tenancy changes. If the tenancy write fails after the Schedule write succeeded (including a wrong Tenants header), the response says so plainly (the payment is saved; add the details from the tenant page). Nothing is rolled back. Undoing a New tenant payment does not reverse tenancy changes: the previous tenant's details stay marked as moved out, and the new tenant's details stay. They can be edited from the details page.
- All routes require a signed-in listed person. Every tenancy change records who and when. Everyone on the list may edit; only the owner rules from wave A are unchanged.
- New routes: `POST /api/tenancies` (create or update) and `POST /api/tenancies/move-out`. Both set the freshness cookie after success or conflict, as the payment routes do.

## Error handling

- Missing Tenants tab: created. Wrong or missing headers in an existing tab: the app keeps working. The tenant details page names the first wrong header and says that logging rent and the other pages still work. Saving details and recording a move-out are refused with the same message, and nothing is written to the tab. The headers are checked on every read, so putting the header back fixes it within about 15 seconds (the app keeps a short-lived copy of the Sheet).
- Unknown portion, tenancy already closed, invalid input: a clear message and no write.
- Conflict (the stored `Updated at` is not the one the person saw, or the tenancy was closed or removed): nothing is written. The form calls `router.replace` to `/tenants/<portionId>?changed=1`, which also loads the data again. An edit or move-out form closes, so that opening it again starts from the new data. The page itself shows a notice at the top in the warning style: "This changed just now. The page was updated. Please check and save again." The page shows it, not the form, because the refreshed page can replace the form and a message inside the form would go with it. A normal visit has no notice. A save that goes through while the notice is showing opens the plain address again, so the notice goes away.
- A failed Google call: the existing generic message. Single-row writes are one `updateValues` call.

## Testing

All service logic is tested with the in-memory fake gateway, in the style of the existing tests:

- Tab creation and header checks (a wrong header does not stop the rest of the app, and is checked on every read); reading and writing rows; the current-tenancy rule and name matching; hand-edited cells (stray spaces, a space-only move-out date, text in number columns).
- An edit writes only the changed columns; the conflict notice appears only after a conflict.
- Create, update, stale update refused, move-out, move-out of an already closed tenancy refused, validation failures.
- New tenant with and without details, including closing the previous tenancy; payment saved but tenancy write failing.
- Card derivation: chips, "Add details", name-mismatch case.
- Route tests: not signed in, not on the list, valid and invalid bodies, freshness cookie.
- Pure helpers: date and amount validation, ids, chip text.
- Extend `scripts/verify-testcopy.ts` to create, update and move out a tenancy on the test copy through the real Google API.
- Manual check on a phone: the details page, the edit and move-out forms, chips on cards, the New tenant section.

## Rollout

1. Merge and deploy. The Tenants tab is created the first time anyone opens the app.
2. The owner adds details for current tenants whenever convenient, from the Add details link. Nothing else changes until then.
3. Old cell comments are not imported. The owner can copy what they need by hand.

## Decisions made on the owner's behalf

- A separate details page, not a bottom sheet, because the forms are long.
- Everyone on the allow-list may edit tenancy details and record move-outs.
- Dates as plain text in the Sheet, not Sheet date cells.
- No ID-proof or meter-reading fields; the Notes field covers them.
- A card ignores details whose tenant name does not match the Schedule.
