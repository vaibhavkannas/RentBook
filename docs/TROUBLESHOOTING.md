# Troubleshooting

What RentBook says when something goes wrong, and what to do. Each message below is quoted from the app. Where part of a message changes (a portion's name, a month, a tab), it is written in braces. Only the owner can fix most of these; a member should tell the owner what the screen said. For how to use the app, see [USER-GUIDE.md](USER-GUIDE.md). For setting it up, see [SETUP.md](SETUP.md).

## Start here

- The owner, when you can sign in: open **More**, then **Set up**. It checks each part of the connection to your Sheet and, for anything wrong, says what to do. **Diagnostics**, also under **More**, shows whether the Sheet answers, how fast, and how many problems this server has logged.
- A member: the connection is the owner's to fix. Tell the owner what the screen said, word for word.
- The server log: every line RentBook writes is one JSON line with a `code` and, for a failed request, a `requestId`. The same id is in the error the browser got. The lines are built from a few fixed fields and carry no secret and no request body, but they can name an address, so keep them private. On Vercel, open the project's Logs.
- Is it up at all? Open `/api/health` on the app's address. It answers `{"ok":true,"version":"..."}` without reading your settings or the Sheet, so it can say "up" while sign-in or the Sheet is not set up.

## Signing in

> "That Google account isn't on the list for RentBook. Ask the owner to add it, or sign in with another account."

The account is not in `ALLOWED_EMAILS`. The owner adds it there, in `.env.local` and in Vercel, then redeploys. The owner's address goes first. While the Google Cloud app is in Testing, the address must also be listed under Test users (SETUP, step 5).

> "Sign-in isn't set up correctly. If you are the owner, check the sign-in settings in SETUP.md."

A sign-in setting is missing or wrong: `AUTH_SECRET` (at least 32 characters), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, or `AUTH_URL` (the app's own address with no path, or left out; an empty `AUTH_URL` counts as set, so delete the line instead). While this shows, nobody can sign in, so **Set up** cannot be opened: it is for a signed-in owner. Look in the server log and in SETUP.md instead. The log has a `request-error` line whose message names each sign-in setting that is missing or too short, such as `AUTH_SECRET is missing.` (it never holds a value), and an `auth-error` line that names the kind of error Auth.js reported. SETUP.md, step 6, lists every setting. A log line that mentions `UntrustedHost` means the app does not trust the address it was opened on: set `AUTH_URL` to it (SETUP, step 7). See "If sign-in fails" in [SETUP.md](SETUP.md).

> "Sign-in didn't work. Try again."

Google sent the person back with an error RentBook does not name. Try once more. If it repeats, the log has an `auth-error` line with its kind.

`Error 400: redirect_uri_mismatch` is Google's own message, not RentBook's. The redirect address in the Google Cloud sign-in client has to match the app's address exactly, including http or https, the port and no trailing slash. SETUP, step 5 and step 7, say what to add.

> "You've been signed out. Tap another tab at the bottom of the screen to sign in again."

A sign-in lasts seven days from the moment of signing in, and using the app does not extend it. Sign in again. If everyone is signed out at once, it is usually because the owner set `SESSION_NOT_BEFORE` or changed `AUTH_SECRET`.

`SESSION_NOT_BEFORE` is the "sign everyone out" switch. Set it to the current date and time in UTC, in this form, then redeploy: `2026-10-16T10:00:00Z`. Everyone who signed in before that moment signs in again. It must be now or earlier. A time in the future refuses every sign-in made before it, new ones too, so everyone, the owner included, is signed out again right after signing in until that time comes. Leaving a value that is now or earlier in place is fine: it only affects sessions older than it. A value that cannot be read as a date also signs everyone out until it is fixed, and says so in the server log:

> "SESSION_NOT_BEFORE is not a date and time (for example 2026-10-16T10:00:00Z), so every session is refused."

Nobody can open **Set up** while everyone is signed out, so the log is where to look. Correct the value, set it to a time that has passed, or delete it, in Vercel (and `.env.local`), and redeploy.

## The Sheet

A screen that cannot read your Sheet shows **Can't load your Sheet**, the reason, and **Try again**. For the owner, a problem Set up can explain also shows **Open Set up to see what is wrong**. A member sees only:

> "The Sheet connection needs attention. Ask the owner."

That is the member's version of every connection problem below (the key, the sharing, `SHEET_ID`). The owner sees the real one:

> "Google rejected the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT_JSON."

The key was deleted, has expired or is wrong. Make a new key in Google Cloud (SETUP, step 3) and put it in `GOOGLE_SERVICE_ACCOUNT_JSON`, then redeploy.

> "Google denied access{ (details)}. Share the Sheet with {the service account's address} as Editor."

The Sheet is not shared with the service account. Share it as Editor and untick "Notify people" (SETUP, step 4). The address to use is on **Set up**.

> "The Google Sheets API is not enabled for the service account's Cloud project. In Google Cloud Console open APIs & Services, then Library, and enable the Google Sheets API."

Do what it says (SETUP, step 2).

> "This file is an Excel (.xlsx) file, not a Google Sheet. In Google Drive open it, choose File, Save as Google Sheets, then use the new file's ID as SHEET_ID."

RentBook cannot write to an uploaded Excel file. Convert it, then change `SHEET_ID` and redeploy.

> "Google could not find that Sheet. Check SHEET_ID."

`SHEET_ID` is wrong. It is the part of the Sheet's address between `/d/` and `/edit`, with nothing else.

> "Google isn't responding. Try again in a minute."

> "Google is limiting requests right now. Wait a minute and try again."

> "Couldn't reach Google Sheets. Try again."

Nothing to fix. Google was slow, busy or out of reach. Wait a minute and try again.

### A tab or a header is missing

**Set up** names the tab or header and what to do. These are the messages behind it.

> "The tab "{tab}" was not found in your Sheet. Restore it from File > Version history or rename it back."

A tab was deleted or renamed. Put it back, or rename it back.

> "The {Settings tab} is missing. Restore it from File > Version history or rename it back. RentBook will not recreate it because that would reset your rent cycle lengths and hike percentages."

The tab name is the one you gave it, usually Settings. RentBook makes its own tabs on a new Sheet, but it never makes this one again while the others are there: fresh defaults would replace your cycle lengths and hikes. Restore the tab from the version history, or rename it back. **Prepare my Sheet** on **Set up** makes any other tab that is missing.

> "No header row containing "Month" was found in the Schedule tab."

The Schedule needs one row in its first 25 rows that has Month in it. If your tab has another name, set `SCHEDULE_TAB`.

> "Header "{name}" was not found in the Schedule tab. Check the spelling in the Schedule header row (row {number}){where}"

A header in Portion settings is not in the Schedule's header row, or was renamed there. Make the two match.

> "Header "{name}" appears more than once in the Schedule tab."

Each Tenant, Count and Amount header may appear once. Rename the repeats, for example Tenant2, Count2, Amount2.

> "The Schedule tab has no month rows to copy the format from."

The Schedule has its header and no month under it. Type the first month's row yourself, in the same style as your others, such as Oct-26, then try again.

> "Row {number} of the Schedule tab has "{text}" in the Month column, which RentBook cannot read as a month. Change it to a month such as "Oct-26", or clear the cell."

Fix that cell. Months have to be in order, one row each, with an empty row under the last.

> "The Tenants tab must have "{header}" in column {letter} (found {what is there}). Columns A to O must keep the 15 Tenants headers in their original order; extra columns may go to the right."

Someone changed a header of the Tenants tab. Put it back. Logging rent and the other pages still work; only tenant details wait.

> "Settings row {number}: Tenant header, Count header and Amount header must all be filled in, or all left blank for a note."

> "Settings rows {number} and {number} both use the portion id "{id}". Give each portion its own id."

> "The Settings tab has no portions."

These are problems in the Settings tab. Fix the row that is named. Do not delete a portion's row while its columns are in the Schedule.

## Saving

A payment, an undo or a change of details that fails says so in its own box, and nothing is lost: you can try again.

> "You're offline, so nothing was sent. Connect to the internet and try again."

> "No answer after 30 seconds. It may still have saved. Tap another tab at the bottom of the screen and come back, then check before trying again."

> "Couldn't confirm that the save went through. Check your connection. Tap another tab at the bottom of the screen and come back, then check before trying again."

The save may or may not have gone through. Do as it says: open another tab at the bottom, come back, and look at the card (or **Activity**) before saving again, so a payment is not logged twice. The undo, a portion change, **Prepare my Sheet** and a tenant save have their own versions:

> "Couldn't confirm that the undo went through."

> "Couldn't confirm that the change went through."

> "Couldn't confirm that your Sheet was prepared."

> "Couldn't reach the server. Try again."

> "Something went wrong on our side. Try again."

This one is not the Sheet's doing. Try again. If it keeps happening, find the line in the server log with the `requestId` shown or the time (`code` is `internal`).

> "This page is out of date. Tap another tab at the bottom of the screen and come back, then try again."

The screen was opened before the Sheet changed. Load it again as it says.

> "That request didn't come from RentBook's own page. Tap another tab at the bottom of the screen and come back, then try again."

> "That request couldn't be read. Tap another tab at the bottom of the screen and come back, then try again."

The save did not come from the app's own page, or could not be read. Reload as it says. If it keeps happening on the app's own page, check that nothing between the phone and the server (a proxy, a content blocker) changes requests.

> "{portion} for {month} was changed by someone else. Tap another tab at the bottom of the screen and come back, then try again."

> "This changed just now. The page was updated. Please check and save again."

Two people changed the same thing. The screen already shows the newer version; check it and make your change again if it is still needed.

### The Payments Log

A payment goes into the Schedule first and the Payments Log second. If only the second step fails, the sheet says:

> "Saved to your Schedule, but the Payments Log entry didn't save."

Tap **Retry log entry**. If that fails:

> "The log entry still didn't save. The payment itself is safe in your Schedule."

> "Couldn't confirm that the log entry saved. Check the Activity screen before trying again."

> "This retry can no longer be used. The change itself is safe in your Schedule. Check the Activity screen, and add the Payments Log entry by hand if it is missing."

The payment is in your Schedule either way. Open **Activity** and look for the entry before retrying, so it is not added twice. If you leave with **Skip for now**, a toast says where the payment is:

> "{portion}: {amount} saved to your Schedule, but not to the Payments Log"

### Tenant details and History

> "Payment saved, but the tenancy details weren't saved. Open the card's details page to check or add them."

A new tenant's first payment was saved without the details typed with it. Open **Details** or **Add details** on the card and add them again.

> "The change was saved, but it couldn't be added to the History."

The change is in the Tenants tab. Its line in the Tenancy Log did not save, even after one automatic retry, so **History** will not show it. Nothing else is affected.

### Refusals

> "{portion} is vacant in {month}: {name} moved out on {date}. Tap another tab at the bottom of the screen and come back, then add the new tenant with New tenant."

A portion whose tenant has moved out has nobody to log rent for. Use **New tenant** on its card. If the vacancy is a mistake, what helps depends on how it came about. A New tenant closes the previous tenant's open details, and undoing that New tenant's first payment opens them again. The app has no undo for a move-out recorded with **Move out** on the tenant page, and a closing left behind when a New tenant was corrected with Replace is not reopened either. For those, open the tenant page and tap **Add details** for the same tenant, which ends the vacancy, or clear the Move-out date of that tenant's row in the Tenants tab (SETUP, "If a portion shows Vacant and it should not").

> "{portion} is switched off in Portion settings. Switch it back on to log rent for it."

> "{portion} is switched off in Portion settings. Switch the portion on first."

Switch the portion on under **More**, **Portion settings**, in the Switched off list.

> "Later months have entries for this portion. Undo those first."

A payment can be undone only while no later month has one. Undo the later ones first, newest first.

> "This payment just changed. Close this and look at the updated card."

Someone else changed or undid the payment while the undo was open. Close the sheet and look at the card.

## If a page is blank or a button does nothing

RentBook sends a Content-Security-Policy, which tells the browser what a page may load and run. If an update leaves a page blank or a button dead, and the browser's console mentions "Content Security Policy", set `CSP_REPORT_ONLY` to `1` in Vercel and redeploy (on your own computer, in `.env.local`, and restart). The browser then only reports what the policy would have blocked, so the page works and one layer of protection is off. **Set up** shows it as Check while it is on.

Use it only until the problem is fixed, then delete the variable and redeploy. Any value other than `1` leaves the policy enforced.
