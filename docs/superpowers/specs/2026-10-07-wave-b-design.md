# RentBook enhancements, wave B: tenancy details

Date: 2026-10-07
Status: approach approved by the owner (a `Tenants` tab in the same Sheet); field list and screens chosen by the assistant, open to change in review

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
| D | `Phone` | Free text, at most 20 characters. |
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
- Header names are matched by text, so the owner may add columns to the right or reorder rows. The app never rewrites or deletes rows it did not touch.

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

Errors use the same pattern as the rest of the app: a short message, nothing half-saved, and a Try again action for read failures.

### New tenant flow

The existing sheet gains a collapsed section "Tenancy details (optional)" with: move-in date (default today), advance, advance date, agreement end, phone. Nothing in it is required. If any field is filled the app creates the tenancy at the same time as the first payment. In every case the previous current tenancy of that portion, if it has no move-out date, is closed with move-out date equal to the new move-in date (or today).

## Server behaviour

- The Tenants tab is read together with Settings and the Schedule in the same parallel read, and is part of the 15-second snapshot cache and its invalidation. Every write clears the cache.
- `saveTenancy`: creates a row (new id) or updates one by id. An update carries the `Updated at` value the person saw; if the stored value differs the app refuses with a conflict and the screen reloads. Validation: dates real, move-in not after agreement end or move-out, amounts whole numbers from 0 to 10,000,000, text lengths as above, the portion must exist.
- `moveOut`: sets move-out date, advance status, refund, deductions and notes on the current tenancy, with the same stale-screen check. Refused when the tenancy already has a move-out date.
- `logPayment` accepts optional tenancy details for the New tenant flow, writes the Schedule cells and the Payments Log row as today, and then writes the tenancy changes. If the tenancy write fails after the Schedule write succeeded, the response says so plainly (the payment is saved; add the details from the tenant page). Nothing is rolled back.
- All routes require a signed-in listed person. Every tenancy change records who and when. Everyone on the list may edit; only the owner rules from wave A are unchanged.
- New routes: `POST /api/tenancies` (create or update) and `POST /api/tenancies/move-out`. Both set the freshness cookie after success or conflict, as the payment routes do.

## Error handling

- Missing Tenants tab: created. Wrong or missing headers in an existing tab: a clear structure error naming the missing header, nothing written.
- Unknown portion, stale screen, tenancy already closed, invalid input: a clear message and no write.
- A failed Google call: the existing generic message. Single-row writes are one `updateValues` call.

## Testing

All service logic is tested with the in-memory fake gateway, in the style of the existing tests:

- Tab creation and header checks; reading and writing rows; the current-tenancy rule and name matching.
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
