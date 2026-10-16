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
| `SCHEDULE_TAB` | Name of the tab that holds the month rows. Defaults to `Schedule` if left out |
| `TOTAL_HEADER` | Exact header text of the monthly total column. No default: it must match the header exactly, including capitals and spaces |

Commands, in PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```powershell
(Get-Content "C:\path\to\your-key.json" -Raw | ConvertFrom-Json | ConvertTo-Json -Compress) | Set-Clipboard
```

Replace the path in the second command with the real location of your key file. It copies the one-line JSON to the clipboard instead of printing it. Paste it after `GOOGLE_SERVICE_ACCOUNT_JSON=`.

Check that `git status` does not list `.env.local`.

Each portion needs its own header names on the Schedule header row: `Tenant`, `Count`, `Amount`, then `Tenant2`, `Count2`, `Amount2`, and so on. RentBook copies them into the `Settings` tab the first time it runs. If you rename a Schedule header later, copy the new name into the `Settings` tab as well.

Install and check the Sheet before the first save. You need Node 22 or newer.

```powershell
npm install
npm run recon
```

`npm run recon` only reads. Fix every problem it lists. Then run the app with `npm run dev` and open http://localhost:3000. Restart the dev server after any change to `.env.local`.

On Windows PowerShell, use `npm.cmd` in place of `npm`, and run it from the project folder. On a company laptop you may also need the certificate setting below. See "Windows and company-network problems".

Before the first save, open Portion settings in the app and set each portion's cycle length (or tick "Count never resets") and hike percent. The app cannot edit a payment count, so a wrong setting here writes a wrong count. Do the same again after you switch to the live Sheet, because it gets its own fresh `Settings` tab with default values.

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
- RentBook says "That Google account isn't allowed": the account you used is not listed in `ALLOWED_EMAILS`. Add it there (in `.env.local`, and in Vercel followed by a redeploy).
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

The first time the new version loads, it adds two new header columns, "Logged by" and "Action", to the Payments Log tab by itself. Older log rows keep those two cells empty and show without an action on the Activity screen. You do not need to edit the tab.

## Tenant details

RentBook keeps each portion's tenancy details (phone, move-in date, agreement end, advance, move-out and notes) in a `Tenants` tab of the same Sheet. The app creates the tab, with its headers, by itself the first time it loads. You do not need to make it. Try it on the test copy first (step 1).

### Before you deploy

- If your live Sheet already has a tab called `Tenants` that holds something else, rename that tab before you deploy (for example to `Tenants old`). RentBook uses the name `Tenants` for its own tab, so it would otherwise try to use yours, and could add its headers to it.
- Old cell comments on the Schedule are not imported. If you want to keep what they say, copy it into the `Notes` of the tenant's details after you deploy.

### How to use it

1. On the month screen, each portion card that has a tenant has a small link under the tenant's name: **Details** when the tenant already has details, **Add details** when not. Tap it to open that portion's details page.
2. **Add details:** on the details page, under Current tenancy, fill in the move-in date and whatever else you know, then tap Save details. Only the move-in date is needed. It starts as today, so change it if the tenant moved in earlier.
3. **Edit:** tap Edit under the details, change what you want, then tap Save details. Only what you changed is written to the Sheet.
4. **Move out:** tap Move out, choose the move-out date, say what happened to the advance (Refunded, Adjusted or Held), type the refund and deductions if there are any, then tap Record move-out. The tenant moves to Past tenants on the same page. Your Schedule is not changed.
5. **New tenant:** tap New tenant on the month screen. The sheet has an optional "Tenancy details (optional)" section. Open it to add the move-in date, advance, advance date, agreement end and phone together with the first payment. Leave it closed to add the details later from the card. Either way, a previous tenant of that portion who still has open details is marked as moved out for you.
6. If a screen shows "This changed just now", someone else (or another tab of yours) changed the same details. The page has already loaded the latest version. Check it, then make your change again.

Undoing a New tenant payment does not reverse tenancy changes. The previous tenant's details stay marked as moved out, and the new tenant's details stay as they are. If you need to put that right, open the details page and use Edit, or edit the row in the `Tenants` tab.

### The `Tenants` tab

- The tab must keep these 15 headers in columns A to O, in this order: `Tenancy ID`, `Portion`, `Tenant`, `Phone`, `Move-in date`, `Agreement end`, `Advance`, `Advance date`, `Advance status`, `Refund`, `Deductions`, `Notes`, `Move-out date`, `Updated by`, `Updated at`. If one is missing or different, the tenant details pages show a message that names it, and no tenant details are saved until you put the header back. Logging rent, undo, Activity and Settings keep working. The app checks the headers every time it reads the tab, so the pages work again within about 15 seconds of putting the header right. You may add your own columns to the right of column O. The app ignores them.
- You can edit rows by hand. When the app saves a change it writes only the columns that change belongs to, so what you typed in the other columns of that row stays. Leave `Tenancy ID` alone: it is how the app finds the row.
- Type the date columns (`Move-in date`, `Agreement end`, `Advance date`, `Move-out date`) as plain text in the form `YYYY-MM-DD`, for example `2026-10-07`. The app also reads real Sheet dates, so a cell that Google Sheets turned into a date still works.
- `Advance status` must be exactly `Held`, `Refunded` or `Adjusted` (capital first letter). Leave it blank when there is no advance. Any other text is ignored.
- `Advance`, `Refund` and `Deductions` are whole rupees typed as numbers. Text typed into a number column is ignored.
- A blank `Move-out date` means the tenancy is current. A cell that holds only spaces counts as blank. A portion's current tenancy is the last row for that portion with a blank move-out date. Adding a date there moves the tenant out.
- A card shows a tenancy's details only while its `Tenant` is the name the Schedule shows for that portion (capitals and surrounding spaces do not matter).
- `Updated by` and `Updated at` are written by the app. `Updated at` is also how it notices that someone changed a row after you opened it.

## 7. Deploy to Vercel

1. Sign in at https://vercel.com with GitHub, choose Add New, then Project, and import `vaibhavkannas/RentBook`.
2. Under Environment Variables add every name from step 6: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` (for Production only, set to the production address), `ALLOWED_EMAILS` (the owner first), `GOOGLE_SERVICE_ACCOUNT_JSON` (paste it as one line, with no quotes), `SHEET_ID`, `SCHEDULE_TAB` and `TOTAL_HEADER`. Use the test copy's `SHEET_ID` for the first deploy. Add them for Production and Preview, except the three secrets (`GOOGLE_SERVICE_ACCOUNT_JSON`, `AUTH_SECRET` and `AUTH_GOOGLE_SECRET`), which are set up as described in "Keeping your secrets safe" below. A deployment that still has the older single `ALLOWED_EMAIL` keeps working until `ALLOWED_EMAILS` is set.
3. Deploy. A first import deploys the production branch (`main`). Work on a branch gets its own preview URL until its pull request is merged.
4. Google does not accept wildcard redirect URIs. In Google Cloud, edit the OAuth client and add `https://<host>/api/auth/callback/google` for every host you sign in on: the preview URL now and the production URL later.
5. Open the URL on your phone, sign in, and use the browser menu's Add to Home Screen.
6. Switching to your live Sheet is a separate, later step: change `SHEET_ID` (and `SCHEDULE_TAB` if the tab name differs) in Vercel, then redeploy. Running deployments keep the old values. The end-to-end checklist in the implementation plan (Task 18) walks through it.

If sign-in fails with an `UntrustedHost` error (more likely with `npm start` than on Vercel), set `AUTH_URL` to the address you are using, or add the environment variable `AUTH_TRUST_HOST=true`, and restart or redeploy. An empty `AUTH_URL` counts as set and turns trust off, so remove the line instead of leaving it empty.

## Keeping your secrets safe

Do these when you set up Vercel. They cost a few minutes and limit the damage if something leaks. How the app is protected, and what it cannot protect, is in `docs/product/THREAT-MODEL.md`.

1. **Make the three secrets Sensitive and Production-only.** Add `GOOGLE_SERVICE_ACCOUNT_JSON`, `AUTH_SECRET` and `AUTH_GOOGLE_SECRET` in Vercel with Sensitive switched on and only the Production environment ticked. Vercel does not show a Sensitive value again after you save it, so keep your own copy in a password manager (not in the repo, and not in a OneDrive-synced folder). To change one later, replace it.
2. **Use a separate test Sheet and service account for Preview deployments.** A Preview deployment runs the code of any branch or pull request, so it must not hold the live key or point at the live Sheet. Create a second service account (step 3), share only the test copy with it, and put that key and the test copy's `SHEET_ID` in the Preview environment. Give Preview its own `AUTH_SECRET` too (a different random string), and its own sign-in client if you want to sign in on previews. A preview that has no values of its own for the three secrets does not work, which is safe.
3. **Rotate the service account key every 90 days.** Put a reminder in your calendar. In Cloud Console open Service Accounts, then Keys, then Add key, then Create new key (JSON). Put the new key in `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and `.env.local`, redeploy, open the app and check that a month loads, then delete the old key in Cloud Console and the key file you downloaded. Do the same for the test service account. If a key leaks, do not wait: see "Rotating or revoking access".
4. **Turn on 2-Step Verification on every Google account that is listed.** That means each address in `ALLOWED_EMAILS`, and the account that owns the Sheet and the Google Cloud project. RentBook relies on Google to say who someone is. Anyone who takes over a listed account can sign in to RentBook as that person. Anyone who takes over the account that owns the Sheet can also read and change the Sheet directly.
5. **Know the `CSP_REPORT_ONLY` switch.** The app sends a Content-Security-Policy, which tells the browser what a page may load and run. If an update leaves a page blank or a button dead and the browser console mentions "Content Security Policy", set `CSP_REPORT_ONLY` to `1` in Vercel and redeploy (locally, set it in `.env.local` and restart `npm run dev`). The browser then only reports what the policy would have blocked and blocks nothing, so one layer of protection is off. Use it only until the problem is fixed, then delete the variable and redeploy. Any value other than `1` leaves the policy enforced.

## Rotating or revoking access

- To stop the app writing: remove the service account from the Sheet's sharing list.
- If the key file leaks: delete the key in Cloud Console (Service Accounts, Keys), create a new one, and update `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and `.env.local`. Redeploy after changing Vercel variables.

## Signing everyone out

A sign-in lasts seven days, and is renewed while the app is in use. Removing an address from `ALLOWED_EMAILS` locks that person out on their next request. To sign out everyone at once (for example after a lost phone, or if you think `AUTH_SECRET` leaked), set `SESSION_NOT_BEFORE` to the current date and time in UTC, in the form `2026-10-16T10:00:00Z`, in Vercel (and `.env.local`), then redeploy. Every session signed in before that moment is refused, and people sign in again. Sessions that were already open when this version was first deployed carry no sign-in time, so they are signed out too the first time you set it. You can leave the value in place afterwards: it only affects sessions older than it. If the value is not a valid date and time, everyone is signed out and the server log says so, so check the spelling.

If `AUTH_SECRET` itself leaked, also generate a new one (step 6) and replace it. That signs everyone out as well, and makes any retry token or "just wrote" cookie made with the old one useless.
