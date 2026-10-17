# RentBook

A phone-first web app for recording monthly rent receipts for a building with five portions. It writes into your existing Google Sheet, which stays the only place the data lives.

- Month overview with one card per portion: tenant, payment count, rent, Paid or Pending.
- Log a payment in a few taps. The count and the 5% hike suggestion are worked out for you, and you can edit the amount.
- Per-portion cycle length (or "never resets") and hike percent.
- Each payment also lands in a `Payments Log` tab with the date it was received and who logged it.
- Undo a mistaken payment, and let several people sign in (the first one listed is the owner).
- The Activity screen reads like a diary: entries are listed under the day they were saved on (India time), newest first, each as a sentence such as "Undid Asha's September 2026 payment of ₹ 12,700." with the time, who did it and the day the money was received. Two rows of chips narrow it to Logged, Changed or Undone entries and to one portion. It shows the newest 50 matches from the newest 500 rows of the `Payments Log` tab, which it only reads.
- The month summary shows what was received against the rent due, and any extra or shortfall. A paid card says when the amount was more or less than the usual rent (the suggested amount, hike included).
- A bar at the bottom switches between Month, Activity and More (the account, the owner's portion settings and Sign out). Switching months does not add browser history, and the Month tab, the arrow back on the other screens and the system Back all return to the month that was showing, so Back leaves the month screen instead of stepping through every month. A tab or an arrow back loads the screen again, so it shows the Sheet as it is now, while the phone's own Back button shows the screen as it was kept: after using it, go to another tab and back (or pull down, in a browser tab) to see another person's latest entry. In an installed Android app, Back on the month screen first shows "Press back again to exit". It needs a tap on the screen first, and does nothing in an ordinary browser tab or in an iPhone or iPad home-screen app (Back cannot exit those). If Back is pressed again after the message has gone, without tapping anything in between, the app simply exits.
- Tenant details for each portion (phone, move-in, agreement end, advance, move-out) kept in a `Tenants` tab of the same Sheet, shown on the card and on a tenant page with past tenants.

## Develop

```bash
npm install
cp .env.example .env.local   # then fill it in, see SETUP.md
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run recon` | Read-only check of your Google Sheet. Never writes |
| `npm run verify:testcopy` | End-to-end log, edit, undo, Activity and tenant-details check against a test copy of the Sheet. Needs `TEST_SHEET_ID`; refuses to run on the real Sheet. The copy's Schedule must already have a row for 2040-04 with no payment for portion p5 (new month rows can only be added in order); the script checks this first and stops before writing if not. The "Verify Tenant" rows it adds to the Tenants tab (p5 only) stay in the test copy, already moved out |

## Setup and deployment

See [SETUP.md](SETUP.md).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). How the app is protected, and what it cannot protect against, is in [docs/product/THREAT-MODEL.md](docs/product/THREAT-MODEL.md).

## How it works

Rules live in `src/lib/domain` (pure, no I/O). Everything that touches the Sheet is in `src/lib/sheets`, behind one interface, so tests use an in-memory fake. Design notes are in `docs/superpowers/specs/`.
