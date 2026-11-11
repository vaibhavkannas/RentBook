# RentBook

A phone-first web app for recording monthly rent receipts for a building with several portions. It writes into your existing Google Sheet, which stays the only place the data lives.

- Month overview with one card per portion: tenant, payment count, rent, Paid or Pending.
- Log a payment in a few taps. The count and the 5% hike suggestion are worked out for you, and you can edit the amount.
- Per-portion payments per cycle (or "Count never resets") and the hike at each new cycle (%).
- A portion with no tenant is Vacant. Its card says since when and has an Add tenant button, it adds nothing to the rent due, and the month summary counts only the portions that are let ("3 of 4 portions · 1 vacant"). A tenant can be moved out with or without details on file, and the move-out writes to the `Tenants` tab only.
- The owner can add, switch off and reorder portions in Portion settings, without editing the Sheet by hand. A switched-off portion keeps its history and leaves the month screen. A Sheet laid out a little differently from the owner's still works: the total column is optional and the tabs may have other names.
- Set up and Diagnostics, for the owner, in More. Set up is a guided check of the connection to the Sheet, with a Prepare my Sheet button that makes the tabs the app needs. Diagnostics shows the version, how fast the Sheet answers and what each tab holds. Neither shows a secret or any tenant data.
- Each payment also lands in a `Payments Log` tab with the date it was received and who logged it.
- Undo a mistaken payment, and let several people sign in (the first one listed is the owner).
- The Activity screen reads like a diary: entries are listed under the day they were saved on (India time), newest first, each as a sentence such as "Undid Asha's September 2026 payment of ₹ 12,700." with the time, who did it and the day the money was received. Entries are grouped in one card for each day. Two rows of chips narrow it to Logged, Changed or Undone entries and to one portion. It looks through the whole `Payments Log` tab, which it only reads, and shows the newest 50 matches.
- The month summary shows what was received against the rent due, and any extra or shortfall. A paid card says when the amount was more or less than the usual rent (the suggested amount: the first payment of the current hike cycle, with the hike added when a new cycle starts).
- A bar at the bottom, with an icon for each, switches between Month, Activity and More (the account, Overdue rent, Year at a glance and Agreements and hikes, the owner's Portion settings, Set up and Diagnostics, an Appearance choice of Auto, Light or Dark, and Sign out). The month screen is a summary with a ring, filter chips and one line for each portion (Paid, Pending, Overdue or Vacant) that opens on a tap. Switching months does not add browser history, and the Month tab, the arrow back on the other screens and the system Back all return to the month that was showing, so Back leaves the month screen instead of stepping through every month. A tab or an arrow back loads the screen again, so it shows the Sheet as it is now, while the phone's own Back button shows the screen as it was kept: after using it, tap another tab at the bottom of the screen and come back (or pull down, in a browser tab) to see another person's latest entry. In an installed Android app, Back on the month screen first shows "Press back again to exit". It needs a tap on the screen first, and does nothing in an ordinary browser tab or in an iPhone or iPad home-screen app (Back cannot exit those). If Back is pressed again after the message has gone, without tapping anything in between, the app simply exits.
- Tenant details for each portion (phone, move-in, agreement end, advance, move-out) kept in a `Tenants` tab of the same Sheet, shown on the card and on a tenant page with past tenants.
- Overdue rent: who owes what, the most owed first, counted from the 6th of the month, with a "Needs attention" card on the month screen. It lists only months with no payment recorded, at the rent the month card suggests: a month with any payment is never overdue, whatever the amount.
- Year at a glance: each portion's twelve months as a grid, with what was received against what was due.
- Agreement and hike alerts: agreements that end within 60 days (or have ended) and rents that go up within two months.
- Tenancy history: every change made in the app to a tenant's details (added, edited, moved out, closed by a new tenant, opened again by an undo) is recorded in a `Tenancy Log` tab with who made it and when, and listed as History on the tenant page. Phone numbers and notes are recorded only as changed. Changes made straight in the Sheet are not.

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
| `npm run e2e` | Builds a temporary copy of the app with an in-memory Sheet and drives a phone-sized browser through it. Never reaches Google. See End-to-end check below |
| `npm run recon` | Read-only check of your Google Sheet. Never writes |
| `npm run verify:testcopy` | End-to-end log, edit, undo, Activity and tenant-details check against a test copy of the Sheet. Needs `TEST_SHEET_ID`; refuses to run on the real Sheet. The copy's Schedule must already have a row for 2040-04 with no payment for portion p5 (new month rows can only be added in order); the script checks this first and stops before writing if not. The "Verify Tenant" rows it adds to the Tenants tab (p5 only) stay in the test copy, already moved out, and so do their rows in the Tenancy Log, which the script checks |

## End-to-end check

`npm run e2e` makes a temporary copy of the app with an in-memory Sheet in place of Google's, builds it, starts it with made-up settings and drives a phone-sized Chromium (390 by 844) through every screen and the main journeys: the sign-in page, logging, editing and undoing a payment, a new tenant, a move-out, the reports, Portion settings, and a Sheet that cannot be read. The two people it uses are signed in with cookies the run makes itself, so Google's sign-in is not used. The browser refuses every request that is not to the local server, so the run never reaches the Google Sheets API or any Google account and never touches your Sheet; only the build of the copy downloads the Inter and Space Grotesk fonts from Google Fonts, with no credentials. It takes about a minute. The copy is deleted when the run ends, Ctrl-C included, unless a check failed or you gave `--keep`; then it is kept, with a screenshot of each failure. The server never outlives the run: a small watchdog beside it ends it if the run is killed hard (a run killed that way cannot delete its copy in the temporary folder).

Playwright is installed outside the project, so it is not in `package.json`: run `npm install -g playwright` and `npx playwright install chromium`, or set `E2E_PLAYWRIGHT` to the folder of the playwright package. The check is not run in CI, which has no browser. Options, after `--`: `--keep` keeps the copy, `--only sweep,undo` runs only those checks (and the ones they start from), `--shots <folder>` saves a screenshot of each page, light and dark. `E2E_WIDTH=360` runs the pages at a 360 px phone instead of 390. The exit code is 0 when every check passed, 1 when one failed and 2 when the run could not start.

## Guides

- [User guide](docs/USER-GUIDE.md): how to use the app.
- [Troubleshooting](docs/TROUBLESHOOTING.md): what each message means and what to do.
- [SETUP.md](SETUP.md): setting it up and deploying it.
- [SECURITY.md](SECURITY.md): reporting a vulnerability.
- [Threat model](docs/product/THREAT-MODEL.md): how the app is protected, and where that stops.

## Setup and deployment

See [SETUP.md](SETUP.md).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). How the app is protected, and what it cannot protect against, is in [docs/product/THREAT-MODEL.md](docs/product/THREAT-MODEL.md).

## How it works

Rules live in `src/lib/domain` (pure, no I/O). Everything that touches the Sheet is in `src/lib/sheets`, behind one interface, so tests use an in-memory fake. Design notes are in `docs/superpowers/specs/`.
