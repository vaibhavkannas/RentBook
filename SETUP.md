# RentBook setup

One-time setup. Do steps 1 to 6 for local use, then step 7 to deploy.

Never commit secrets. `.env.local` is git-ignored. Keep the service account key file out of the repo and out of any OneDrive-synced folder (Documents and Downloads are often synced). Delete the key file once `.env.local` and Vercel hold the key.

Google Cloud and Vercel rename their menus from time to time. If a label below is missing, look for the closest match.

## 1. Use a native Google Sheet

RentBook cannot write to an uploaded `.xlsx`. A file opened with `rtpof=true` in its URL, or showing an `.XLSX` badge next to the title, is an Excel file. Convert it: File, then Save as Google Sheets. Use the new file.

Make a copy named "RentBook test copy" (File, Make a copy) and use the copy until you have tested everything. Keep a backup of the original.

The Sheet ID is the long part of the URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

## 2. Create a Google Cloud project and enable the Sheets API

1. Open https://console.cloud.google.com and create a project named "RentBook".
2. APIs & Services, then Library. Search "Google Sheets API" and click Enable.

## 3. Create the service account (the app's identity for the Sheet)

1. IAM & Admin, then Service Accounts, then Create service account. Name it "rentbook".
2. Open the new account, go to Keys, then Add key, then Create new key, type JSON. A file downloads.
3. Move the file somewhere safe outside the repo and outside OneDrive. Treat it like a password.
4. Copy the `client_email` value from the file (it looks like `rentbook@<project>.iam.gserviceaccount.com`).

If Google refuses to create the key, your account's organization has a policy against it. Use a personal Google account for this project.

## 4. Share the Sheet with the service account

In the Sheet, click Share, paste the `client_email`, give it Editor access, and untick "Notify people". Share the test copy first.

## 5. Create the sign-in (OAuth) client

1. APIs & Services, then OAuth consent screen. Newer consoles call this Google Auth Platform, with Branding, Audience, and Clients pages. Choose External. Fill in the app name and your email. Leave the publishing status as Testing and add your own Google email under Test users.
2. Create an OAuth client ID of type Web application (under Credentials, or under Clients).
3. Under Authorized redirect URIs add `http://localhost:3000/api/auth/callback/google`.
4. Copy the client ID and client secret now. Newer consoles show the secret only once.

While the app is in Testing, Google shows an "unverified app" warning at sign-in. Click Continue, or Advanced and then continue. Only the test users you added can sign in.

## 6. Create `.env.local`

Copy `.env.example` to `.env.local` and fill it in. Put each value directly after the `=`, with no surrounding quotes.

| Name | Value |
| --- | --- |
| `AUTH_SECRET` | A random string of at least 32 characters (the app refuses shorter ones). Use the first command below, which makes 44 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | From step 5 |
| `AUTH_URL` | Optional while you run the app on your own computer. For the production deployment, the public address of the app, such as `https://rentbook.example.com`, with no path. Auth.js then builds the Google sign-in return address from it instead of trusting the request's Host header. Leave it out (do not leave it empty) on Vercel Preview deployments, which each have their own address |
| `SESSION_NOT_BEFORE` | Optional, and normally left out. The "sign everyone out" switch: see "Signing everyone out" below |
| `CSP_REPORT_ONLY` | Optional, and normally left out. An emergency switch that stops the browser blocking what the Content-Security-Policy forbids: see "Keeping your secrets safe" below. Only the value `1` turns it on |
| `ALLOWED_EMAILS` | The Google accounts allowed to sign in, separated by commas. The first one is the owner and is the only person who can change Portion settings. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The key file as one line. Use the second command below and paste |
| `SHEET_ID` | From step 1 (the test copy) |
| `SCHEDULE_TAB` | Name of the tab that holds the month rows. Defaults to `Schedule` if left out. A tab that differs only by capitals or spaces is found too |
| `TOTAL_HEADER` | Optional. The header text of the monthly total column, if your Schedule has one. It must appear once in the header row; capitals and extra spaces do not matter. When it is set, RentBook keeps that column up to date: a total that adds the row up with a formula is copied to each new month, and a total you typed is worked out and written. When it is left out, RentBook writes no total, so a total you type yourself goes out of date as you log payments |
| `SETTINGS_TAB` | Optional. What RentBook's own settings tab is called in your Sheet. Defaults to `Settings`. Read "Giving RentBook's own tabs other names" below before you set it |
| `LOG_TAB` | Optional. What RentBook's own payments log tab is called. Defaults to `Payments Log`. Read the same note before you set it |
| `TENANTS_TAB` | Optional. What RentBook's own tenant details tab is called. Defaults to `Tenants`. Read the same note before you set it |

Commands, in PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```powershell
(Get-Content "C:\path\to\your-key.json" -Raw | ConvertFrom-Json | ConvertTo-Json -Compress) | Set-Clipboard
```

Replace the path in the second command with the real location of your key file. It copies the one-line JSON to the clipboard instead of printing it. Paste it after `GOOGLE_SERVICE_ACCOUNT_JSON=`.

Check that `git status` does not list `.env.local`.

**Giving RentBook's own tabs other names.** `SETTINGS_TAB`, `LOG_TAB` and `TENANTS_TAB` are for a Sheet that already uses one of those names for something else, or where you simply want other names. If RentBook's tab is already in your Sheet and you want it called something else, rename your own tab in your Sheet first, then set the variable. If you set a name that is not in your Sheet yet, RentBook starts a new tab with that name and leaves your old tab alone. It does this on the first page view after you set the name (not only when you tap Prepare my Sheet), and a new Settings tab starts with the default values: 11 payments per cycle and a 5% hike for every portion. So set the variable only after the rename. A tab name can have at most 100 characters. `SCHEDULE_TAB` and the three names must each name a different tab, and `SCHEDULE_TAB` can't be `Settings`, `Payments Log` or `Tenants`: RentBook keeps those names for its own tabs, even when it stores them under another name.

Each portion needs its own header names on the Schedule header row: `Tenant`, `Count`, `Amount`, then `Tenant2`, `Count2`, `Amount2`, and so on. RentBook copies them into the `Settings` tab the first time it runs. If you rename a Schedule header later, copy the new name into the `Settings` tab as well. Once the `Settings` tab exists, the names in it decide, and they can be anything: see "Your Sheet's layout" below.

Install and check the Sheet before the first save. You need Node 22 or newer.

```powershell
npm install
npm run recon
```

`npm run recon` only reads. Fix every problem it lists. Then run the app with `npm run dev` and open http://localhost:3000. Restart the dev server after any change to `.env.local`.

On Windows PowerShell, use `npm.cmd` in place of `npm`, and run it from the project folder. On a company laptop you may also need the certificate setting below. See "Windows and company-network problems".

Before the first save, open More and then Portion settings in the app and set each portion's payments per cycle (or tick "Count never resets") and the hike at each new cycle (%). The app cannot edit a payment count, so a wrong setting here writes a wrong count. Do the same again after you switch to the live Sheet, because it gets its own fresh `Settings` tab with default values.

## Check your setup in the app

Once the app opens and you can sign in, the owner can check the connection from the app itself: open More, then **Set up**. Set up and Diagnostics are the owner's. Anyone else who opens them is told they are for the owner and sees nothing more.

Set up only reads. It shows six steps, each with a pill (OK, Check, Fix, To do or Waiting), and under each what was found and, for Check and Fix, what to do:

1. Sign-in
2. Google service account
3. Your Sheet
4. Schedule tab
5. RentBook's tabs
6. Portion settings

The page shows no secret, key, token or setting value and no tenant data: only tab titles, header texts, counts, times, and the service account's address (the one you share the Sheet with, step 4). Under the steps, "What your Sheet needs" lists the rules in "Your Sheet's layout" below. Tap **Check again** after you fix something.

**Prepare my Sheet.** When one of RentBook's own tabs (Settings, Payments Log or Tenants, under the names you gave them) is missing, or is there but empty, and the service account, the Sheet and the Schedule tab are not failing, Set up offers a Prepare my Sheet button. It adds the missing tabs with their headers and fills in an empty one. It starts Settings from your Schedule's header row, with 11 payments per cycle and a 5% hike for each portion, so check them in Portion settings before the first payment. It also fills in a blank H1 or I1 of the Payments Log. It never changes a cell that already holds something and never deletes anything, and only the owner can tap it. The app does the same on its first page view, so Prepare my Sheet is the way to see it happen, and to see what is wrong if it cannot.

**Diagnostics.** More, then **Diagnostics**, shows how the app and your Sheet are doing: the version, when this server started, how many checks are OK (with a link to Set up), whether the Sheet answers and how fast, what each tab holds (counts and times), and how many problems this server has logged since it started. Each server instance counts its own and starts again from zero when it restarts, and Vercel may run several. It shows counts, times and tab names only: no secret and no tenant data.

## Your Sheet's layout

RentBook works with a Sheet laid out a little differently from the owner's example. These are the rules that remain. The Set up page shows the same list under "What your Sheet needs".

- **Schedule tab.** Your month rows are on one tab, called Schedule or the name you set in SCHEDULE_TAB. A tab that differs only by capitals or spaces is found too.
- **Header row.** One of the first 25 rows of that tab is the header row. It has Month in it and, for each portion, a Tenant, a Count and an Amount header. Capitals, extra spaces and no-break spaces do not matter.
- **Portion columns.** Each of those headers must appear once in the header row. Other columns may sit between a portion's three, and a portion's columns can be anywhere in the row. To start Settings for you, Prepare my Sheet needs each portion's three headers to read Tenant, Count and Amount in that order, with the same number after them for the later portions (Tenant2, Count2, Amount2). Once Settings exists, the names in it decide, and they can be anything.
- **Total column.** The total column is optional. Set TOTAL_HEADER to its header (it must appear once) and RentBook keeps it up to date. Leave it out and no total is written, so a total you type yourself will not be kept up to date.
- **Month rows.** Each month has one row. The Month cell is a date or text such as Oct-26, the months are in order, and the row under the last month is empty, so RentBook can add the next one there. It reads columns A to ZZ.
- **Settings tab.** RentBook's own tab. The headers are in row 1 of columns A to G, and column H, headed Active, says which portions are switched off (No). The portions are in rows 2 to 50. Each portion has its own id (letters, numbers, - and _), and the Tenant, Count and Amount header texts must match the Schedule's header row. A note typed under the table is ignored.
- **Payments Log tab.** RentBook's own tab, used by column position, A to I. If column H or I already has another heading, RentBook still writes there (who logged the payment, and what was done) and leaves your heading alone.
- **Tenants tab.** RentBook's own tab. It has 15 headers in columns A to O, in a fixed order; capitals and spaces do not matter. Columns to the right of O are yours.
- **Naming a tab.** To give one of RentBook's own tabs another name (SETTINGS_TAB, LOG_TAB, TENANTS_TAB), rename the tab in your Sheet first, then set the variable. A name that is not in your Sheet yet makes RentBook start a new tab, with the default values for Settings, and leave your old one alone.
- **What the app never does.** RentBook adds to your Sheet and never deletes a row, a column or a tab.

## Windows and company-network problems

These only affect running commands on your own computer. Vercel is not affected.

### `npm.ps1 cannot be loaded because running scripts is disabled`

PowerShell blocks the `npm.ps1` wrapper. Use the `.cmd` version, which needs no policy change:

```powershell
npm.cmd install
npm.cmd run recon
npm.cmd run dev
```

### `Could not read package.json ... C:\Windows\System32\package.json`

The command ran in the wrong folder. A PowerShell opened as administrator starts in `C:\WINDOWS\system32`. You do not need administrator rights for any step here. Change to the project first:

```powershell
cd D:\Repos\RentBook
```

### `self-signed certificate in certificate chain`

Some company networks inspect HTTPS traffic and re-sign it with a company certificate. Windows trusts that certificate. Node does not, so requests to Google fail, and `npm run recon` reports `request to https://oauth2.googleapis.com/token failed`. Tell Node to use the Windows certificate store (needs Node 22.15 or newer):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm.cmd run recon
```

The setting lasts only for that PowerShell window, so set it again in each new window that needs it. Do not make it permanent: it makes Node trust every certificate in the Windows certificate store, and a permanent setting would apply to every Node program you run later. Avoid it on a shared computer, where that store may hold certificates you did not choose. Use `NODE_EXTRA_CA_CERTS` with the one certificate you trust instead (see below).

Set `NODE_OPTIONS` in the shell, not in `.env.local`. Node reads it at start-up, before it loads `.env.local`.

If that is not enough, export your company's root certificate as a `.pem` file and point Node at it with `NODE_EXTRA_CA_CERTS` (for example `$env:NODE_EXTRA_CA_CERTS = "C:\certs\company-root.pem"`). Ask your IT team for the file.

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`. It turns off certificate checking for every request the app makes, including the ones that carry your service account credentials. Your company's network can also see the traffic that passes through it, so use a home network if that matters to you.

## If sign-in fails

- "Access blocked" or "Error 403: access_denied": the Google account you signed in with is not listed under Test users (step 5).
- "Error 400: redirect_uri_mismatch": the redirect URI must match exactly, including http or https, the host, the port, and no trailing slash. `npm run dev` moves to port 3001 when port 3000 is busy; add that URI too, or free port 3000.
- "Error 401: invalid_client": the client ID or secret is wrong, or has stray spaces.
- RentBook says "That Google account isn't on the list for RentBook": the account you used is not listed in `ALLOWED_EMAILS`. Add it there (in `.env.local`, and in Vercel followed by a redeploy).
- RentBook says "Can't load your Sheet": read the message under it. It names the problem, for example that the Sheets API is not enabled or the Sheet is not shared with the service account.

## Adding another person

Everyone on the list can log, edit and undo payments and read the Activity screen. Only the first address in `ALLOWED_EMAILS` (the owner) can change Portion settings.

Try all of this on a test copy of the Sheet first (step 1), then repeat it for the live Sheet.

1. In Google Cloud open the Google Auth Platform, then Audience, then Test users, then Add users, and add their Google address.
2. Set `ALLOWED_EMAILS` in `.env.local` and in Vercel, then redeploy. Separate addresses with commas, for example `owner@example.com, member@example.com`. The first address is the owner. If the deployment still has only the older `ALLOWED_EMAIL`, follow "Moving from `ALLOWED_EMAIL` to `ALLOWED_EMAILS`" below.
3. They open the app, sign in, and click through the "unverified app" warning (Advanced, then continue).
4. They need no access to the Sheet. The app writes as the service account.

Gmail ignores dots and anything after a plus sign, so any spelling of the same Gmail address works in `ALLOWED_EMAILS`. Google Cloud may show the address in its own spelling in the Test users list.

To remove someone, delete the address from `ALLOWED_EMAILS` and redeploy. They are locked out on their next request, even if their session is still valid. You can also remove them from Test users.

### Moving from `ALLOWED_EMAIL` to `ALLOWED_EMAILS`

Older deployments have a single `ALLOWED_EMAIL`. The app still reads it, but only when `ALLOWED_EMAILS` is empty or missing. If `ALLOWED_EMAILS` exists, it wins and `ALLOWED_EMAIL` is ignored. To move over without locking yourself out, in both `.env.local` and Vercel:

1. Create `ALLOWED_EMAILS` with your own address first, because the first address is the owner and the only person who can change Portion settings.
2. Add the new people after it, separated by commas.
3. Delete `ALLOWED_EMAIL`.
4. Redeploy on Vercel, and restart `npm run dev` locally.

The first time the new version loads, it adds two new header columns, "Logged by" and "Action", to the Payments Log tab by itself, into H1 and I1 when those cells are blank. If H1 or I1 already holds another heading, RentBook leaves your heading alone and still writes the person and the action in those columns (the tab is used by column position). Older log rows keep those two cells empty; the Activity screen shows each of them as an "Entry" with "who: not recorded". You do not need to edit the tab.

## Tenant details

RentBook keeps each portion's tenancy details (phone, move-in date, agreement end, advance, move-out and notes) in a `Tenants` tab of the same Sheet. The app creates the tab, with its headers, by itself the first time it loads. You do not need to make it. Try it on the test copy first (step 1).

### Before you deploy

- If your live Sheet already has a tab called `Tenants` that holds something else, rename that tab before you deploy (for example to `Tenants old`), or set `TENANTS_TAB` to another name for RentBook's own tab (a name that is not in your Sheet yet makes RentBook start a new tab with that name, which is what you want here). RentBook uses the name `Tenants` for its own tab unless `TENANTS_TAB` says otherwise, so it would otherwise try to use yours, and could add its headers to it.
- Old cell comments on the Schedule are not imported. If you want to keep what they say, copy it into the `Notes` of the tenant's details after you deploy.

### How to use it

1. On the month screen, each portion card that has a tenant has a small link under the tenant's name: **Details** when the tenant already has details, **Add details** when not. Tap it to open that portion's details page.
2. **Add details:** on the details page, under Current tenancy, fill in the move-in date and whatever else you know, then tap Save details. Only the move-in date is needed. It starts as today, so change it if the tenant moved in earlier.
3. **Edit:** tap Edit under the details, change what you want, then tap Save details. Only what you changed is written to the Sheet.
4. **Move out:** tap Move out, choose the move-out date, say what happened to the advance (Refunded, Adjusted or Held), type the refund and deductions if there are any, then tap Record move-out. The tenant moves to Past tenants on the same page, and the portion shows as Vacant from the month the date leaves vacant. A tenant with no details on file can be moved out too, without adding details first. See "Moving out and vacant portions" below for what a move-out writes and does.
5. **New tenant:** tap New tenant on the month screen (or Add tenant on a vacant portion's card). The sheet has an optional "Tenancy details (optional)" section. Open it to add the move-in date, advance, advance date, agreement end and phone together with the first payment. Leave it closed to add the details later from the card. Either way, a previous tenant of that portion who still has open details is marked as moved out for you, unless the new tenant has the same name: that is the same person starting a count again, so their open details are left as they are.
6. If a screen shows "This changed just now", someone else (or another tab of yours) changed the same details. The page has already loaded the latest version. Check it, then make your change again.

Undoing a New tenant's first payment takes back what it did to the previous tenant's details: see "Moving out and vacant portions" below. It leaves the new tenant's details as they are. If you need to change those, open the details page and use Edit, or edit the row in the `Tenants` tab.

### The `Tenants` tab

- The tab must keep these 15 headers in columns A to O, in this order (capitals and extra spaces do not matter): `Tenancy ID`, `Portion`, `Tenant`, `Phone`, `Move-in date`, `Agreement end`, `Advance`, `Advance date`, `Advance status`, `Refund`, `Deductions`, `Notes`, `Move-out date`, `Updated by`, `Updated at`. If one is missing or different, the tenant details pages show a message that names it, and no tenant details are saved until you put the header back. Logging rent, undo, Activity and Settings keep working. The app checks the headers every time it reads the tab, so the pages work again within about 15 seconds of putting the header right. You may add your own columns to the right of column O. The app ignores them.
- You can edit rows by hand. When the app saves a change it writes only the columns that change belongs to, so what you typed in the other columns of that row stays. Leave `Tenancy ID` alone: it is how the app finds the row.
- Type the date columns (`Move-in date`, `Agreement end`, `Advance date`, `Move-out date`) as plain text in the form `YYYY-MM-DD`, for example `2026-10-07`. The app also reads real Sheet dates, so a cell that Google Sheets turned into a date still works.
- `Advance status` must be exactly `Held`, `Refunded` or `Adjusted` (capital first letter). Leave it blank when there is no advance. Any other text is ignored.
- `Advance`, `Refund` and `Deductions` are whole rupees typed as numbers. Text typed into a number column is ignored.
- A blank `Move-out date` means the tenancy is current. A cell that holds only spaces counts as blank. A portion's current tenancy is the last row for that portion with a blank move-out date. Adding a date there moves the tenant out.
- A card shows a tenancy's details only while its `Tenant` is the name the Schedule shows for that portion (capitals and surrounding spaces do not matter).
- `Updated by` and `Updated at` are written by the app. `Updated at` is also how it notices that someone changed a row after you opened it.

## Moving out and vacant portions

When a tenant leaves, record it on the portion's tenant page, under Move out. A move-out never changes your Schedule. It writes to the `Tenants` tab only:

- With details on file, Move out closes the tenant's row: it fills in the Move-out date, what happened to the advance, the refund, the deductions and the notes you give, and who did it and when.
- Without details (you never tapped Add details), Move out still works. It adds one row to the `Tenants` tab with the tenant's name as your Schedule has it, the move-out date, your notes, and who did it and when, and nothing else.
- A move-out date cannot be before the first day of the month the tenant's rent was last logged for in your Schedule. Choose a date in that month or later, or undo that payment first.

**What Vacant means.** A portion is vacant in a month when its last tenant's move-out date in the `Tenants` tab is on or before the 1st of that month, and no rent is logged for that tenant in a later month. Moving out on the 1st makes that month vacant. Any later day leaves that month due, and the next month vacant. It needs a move-out record whose tenant name matches the tenant your Schedule last names for the portion (capitals and surrounding spaces do not matter). A portion that has never had a tenant also shows as Vacant.

**What you see.**

- A vacant portion's card shows a Vacant pill, "Vacant since" the move-out day and who moved out, a Past tenants link and an Add tenant button, which opens New tenant for that portion. It has no rent to log and adds nothing to what is due for the month.
- The month summary counts only the portions that are let: "3 of 4 portions · 1 vacant".
- A plain Log payment for a vacant month is refused with a message that says to add the new tenant with New tenant. New tenant starts the new tenant at payment 1 and can add their details at the same time.
- A move-out dated after today has not happened yet: the tenant's page says when they will move out, and the rent stays due until the month it leaves vacant.

**Ending a vacancy by hand.** Adding details for the same tenant name on the tenant page ends it, and so does clearing the Move-out date of that tenant's row in the `Tenants` tab (a blank Move-out date means the tenancy is current). New tenant ends it too, by starting someone new.

**Undoing a New tenant.** A New tenant closes the previous tenant's open details, so the previous tenant is not left looking current. Undo of a New tenant's first payment reopens what that request closed: it clears the Move-out date of those rows and writes who undid it and when into Updated by and Updated at. It reopens only a row that carries the same moment and person as that payment's Payments Log row and was closed on the day that request closes on. It never reopens a move-out you recorded with Move out, and it reopens nothing while the portion has another open tenancy. If the payment's Payments Log entry never saved, there is nothing to match and nothing is reopened. If the reopening itself fails, the undo still stands and the row stays closed until you clear its Move-out date by hand.

### If a portion shows Vacant and it should not

A mistaken New tenant is best put right with Undo. If you instead corrected it by logging the old tenant again as New tenant with Replace, the old tenant's row stays closed, because the Sheet cannot tell that from a real move-out. The portion then shows Vacant, with an Add tenant button, though the old tenant is still there. To put it right, open the portion's tenant page and tap Add details for that tenant (adding details for the same name ends the vacancy), or clear the Move-out date of that row in the `Tenants` tab by hand.

### Before you deploy

Do this once, on your live Sheet, before you use this version on it (an owner step; the app cannot do it for you). Older versions of RentBook closed an open `Tenants` row (they filled its Move-out date) when you logged a New tenant with the same name as the tenant already there, and did not reopen it when you undid a New tenant. This version reads a closed row whose tenant is still the one your Schedule last names as a move-out, so such a row would show a tenant who still lives there as Vacant and take their rent out of what is due. Look through your `Tenants` tab for closed rows like that and clear their Move-out date by hand. Try it on your test copy first (step 1).

## Adding, switching off and reordering portions

The owner can add a portion, switch one off and change the order of the portions in the app: More, then **Portion settings**. Each change takes its turn with every other change, reads your Sheet fresh, writes plain values (never formulas), reads back what it wrote, and never deletes a row, a column or a tab, or writes over a cell that holds something. Try them on your test copy first (step 1).

**Before you use them (owner step).** Switching a portion off uses a new, optional column H of the `Settings` tab, headed "Active". The older app never used column H. Before you switch a portion off, check that H1 is blank and column H is empty. If column H holds anything else, RentBook refuses to switch a portion off, says so, and changes nothing. RentBook writes "Active" in H1 itself the first time you switch a portion off, and "No" in the portion's H cell (and "Yes" when you switch it back on). A Settings tab whose H1 is blank, or says anything but Active, is read exactly as before: every portion is on.

**Add a portion.** Tap Add a portion under the form, type the name, set the payments per cycle (or tick Count never resets) and the hike, then tap Add portion. RentBook adds three headers, Tenant, Count and Amount with the next free number after your last portion (for example Tenant6, Count6 and Amount6), to the right of everything already in your Schedule, in the header row, so after your Total column, and a row to the Settings tab under the last portion. It then tells you which Schedule columns it used. Nothing else in your Sheet changes. You can have up to 20 portions.

- RentBook never edits a Total formula. If your total adds the amounts up with a formula, it tells you which column to add to it yourself. If your total holds typed numbers, or you have no total column, there is nothing to add.
- If you already added the three headers yourself (exactly as RentBook would name them, side by side, over empty columns), it uses them instead of adding more.
- It writes the three headers first and the Settings row last. If something fails between the two, only the headers are left. The app ignores headers that have no Settings row, and your next try uses them.
- It reads columns A to ZZ. If there is no room for three more columns, or no free row in Settings up to row 50, it says so and changes nothing.

**Switch off.** Tap Switch off on the portion's card in Portion settings, then Switch off again to confirm. A switched-off portion leaves the month screen and the New tenant list. Its payments stay in your Schedule and Payments Log, its tenants stay on its tenant page, and it is listed under Switched off, where Switch on brings it back. Its history stays. It still shows, marked as switched off, in a past month where it has a payment, and no new payment can be logged for it until you switch it back on. A portion can be switched off only when it is vacant and nothing is owed. If it cannot be switched off, the message says what is in the way (for example a tenant who is still there: record the move-out on the tenant page first). At least one portion stays on.

**Change order.** With two or more portions, tap Change order, move portions up or down, then tap Save order. The month screen lists the portions in that order. RentBook rewrites only the Settings rows whose portion changes (columns A to G, or A to H when there is an Active column). Your Schedule's columns do not move. A Settings row that has a formula in those columns cannot be moved, and anything else you keep in a Settings row, such as its formatting or notes to the right of the portion's cells, stays in that row. It does not move with the portion.

**What is not supported.** These are by-hand jobs in your Sheet, or not possible: deleting a portion or its history, renaming a portion's Schedule headers or moving its columns, changing its id, and editing a Total formula. Also not supported: more than 20 portions, Settings rows past row 50, and using Settings column H for anything but Active.

**To remove a portion completely, in this order.**

1. Switch it off in the app.
2. Delete its three columns in the Schedule only if you do not want its history. Keep a copy of your Sheet first (File, Make a copy). Delete all three, never just some: the app can read a switched-off portion whose three headers are all gone, but not one with only some of them left. Google Sheets leaves #REF! in a Total formula that used a deleted column, so fix that formula by hand.
3. Then delete its Settings row (its row in the Settings tab).

Its rows in the Tenants tab and the Payments Log stay. RentBook does not give its id (for example `p4`) to a new portion while the Tenants tab still has rows for it.

## 7. Deploy to Vercel

1. Sign in at https://vercel.com with GitHub, choose Add New, then Project, and import `vaibhavkannas/RentBook`.
2. Under Environment Variables add every name from step 6: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` (for Production only, set to the production address), `ALLOWED_EMAILS` (the owner first), `GOOGLE_SERVICE_ACCOUNT_JSON` (paste it as one line, with no quotes), `SHEET_ID` and `SCHEDULE_TAB`, and the optional `TOTAL_HEADER`, `SETTINGS_TAB`, `LOG_TAB` and `TENANTS_TAB` if you use them. Use the test copy's `SHEET_ID` for the first deploy. Add them for Production and Preview, except the three secrets (`GOOGLE_SERVICE_ACCOUNT_JSON`, `AUTH_SECRET` and `AUTH_GOOGLE_SECRET`), which are set up as described in "Keeping your secrets safe" below. A deployment that still has the older single `ALLOWED_EMAIL` keeps working until `ALLOWED_EMAILS` is set.
3. Deploy. A first import deploys the production branch (`main`). Work on a branch gets its own preview URL until its pull request is merged.
4. Google does not accept wildcard redirect URIs. In Google Cloud, edit the OAuth client that the deployment uses and add `https://<host>/api/auth/callback/google` for every host you sign in on. The production URL goes on the live client. A preview URL goes on the separate Preview client described in "Keeping your secrets safe" (item 2), not on the live one. Until that client exists, only the Production deployment can sign anyone in.
5. Open the URL on your phone, sign in, and use the browser menu's Add to Home Screen.
6. Switching to your live Sheet is a separate, later step: change `SHEET_ID` (and `SCHEDULE_TAB` if the tab name differs) in Vercel, then redeploy. Running deployments keep the old values. The end-to-end checklist in the implementation plan (Task 18) walks through it.

If sign-in fails with an `UntrustedHost` error (more likely with `npm start` than on Vercel), set `AUTH_URL` to the address you are using, or add the environment variable `AUTH_TRUST_HOST=true`, and restart or redeploy. An empty `AUTH_URL` counts as set and turns trust off, so remove the line instead of leaving it empty.

## Keeping your secrets safe

Do these when you set up Vercel. They cost a few minutes and limit the damage if something leaks. How the app is protected, and what it cannot protect, is in `docs/product/THREAT-MODEL.md`.

1. **Make the three secrets Sensitive and Production-only.** Add `GOOGLE_SERVICE_ACCOUNT_JSON`, `AUTH_SECRET` and `AUTH_GOOGLE_SECRET` in Vercel with Sensitive switched on and only the Production environment ticked. Vercel does not show a Sensitive value again after you save it, so keep your own copy in a password manager (not in the repo, and not in a OneDrive-synced folder). To change one later, replace it.
2. **Use a separate test Sheet and service account for Preview deployments.** A Preview deployment runs the code of any branch or pull request, so it must not hold the live key or point at the live Sheet. Create a second service account (step 3), share only the test copy with it, and put that key and the test copy's `SHEET_ID` in the Preview environment. Give Preview its own `AUTH_SECRET` too (a different random string), and its own sign-in client (step 5, with the preview addresses as redirect URIs) if you want to sign in on previews. A preview that has no values of its own for the three secrets does not work, which is safe.
3. **Rotate the service account key every 90 days.** Put a reminder in your calendar. In Cloud Console open Service Accounts, then Keys, then Add key, then Create new key (JSON). Put the new key in `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and `.env.local`, redeploy, open the app and check that a month loads, then delete the old key in Cloud Console and the key file you downloaded. Do the same for the test service account. If a key leaks, do not wait: see "Rotating or revoking access".
4. **Turn on 2-Step Verification on every Google account that is listed.** That means each address in `ALLOWED_EMAILS`, and the account that owns the Sheet and the Google Cloud project. RentBook relies on Google to say who someone is. Anyone who takes over a listed account can sign in to RentBook as that person. Anyone who takes over the account that owns the Sheet can also read and change the Sheet directly.
5. **Know the `CSP_REPORT_ONLY` switch.** The app sends a Content-Security-Policy, which tells the browser what a page may load and run. If an update leaves a page blank or a button dead and the browser console mentions "Content Security Policy", set `CSP_REPORT_ONLY` to `1` in Vercel and redeploy (locally, set it in `.env.local` and restart `npm run dev`). The browser then only reports what the policy would have blocked and blocks nothing, so one layer of protection is off. Use it only until the problem is fixed, then delete the variable and redeploy. Any value other than `1` leaves the policy enforced.

## Rotating or revoking access

- To stop the app writing: remove the service account from the Sheet's sharing list.
- If the key file leaks: delete the key in Cloud Console (Service Accounts, Keys), create a new one, and update `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and `.env.local`. Redeploy after changing Vercel variables.

## Signing everyone out

A sign-in lasts seven days from the moment of signing in, and no longer. Using the app does not extend it, and the app checks the sign-in time on every request, so even a copy of the sign-in cookie that something keeps renewing stops working after those seven days. People sign in again each week. Removing an address from `ALLOWED_EMAILS` locks that person out on their next request after you redeploy. To sign out everyone at once (for example after a lost phone, or if you think `AUTH_SECRET` leaked), set `SESSION_NOT_BEFORE` to the current date and time in UTC, in the form `2026-10-16T10:00:00Z`, in Vercel (and `.env.local`), then redeploy. Every session signed in before that moment is refused, and people sign in again. Sessions that were already open when this version was first deployed carry no sign-in time, so they are signed out too the first time you set it, and until then they end with their own seven days. This switch is also the way to cut off any old or copied sign-in at once. You can leave the value in place afterwards: it only affects sessions older than it. If the value is not a valid date and time, everyone is signed out and the server log says so, so check the spelling.

If `AUTH_SECRET` itself leaked, also generate a new one (step 6) and replace it. That signs everyone out as well, and makes any retry token or "just wrote" cookie made with the old one useless.
