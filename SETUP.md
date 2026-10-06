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
| `AUTH_SECRET` | A random string. Use the first command below |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | From step 5 |
| `ALLOWED_EMAIL` | The one Google account that may use the app |
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

Before the first save, open Portion settings in the app and set each portion's cycle length (or tick "Count never resets") and hike percent. The app cannot edit a payment count, so a wrong setting here writes a wrong count. Do the same again after you switch to the live Sheet, because it gets its own fresh `Settings` tab with default values.

## If sign-in fails

- "Access blocked" or "Error 403: access_denied": the Google account you signed in with is not listed under Test users (step 5).
- "Error 400: redirect_uri_mismatch": the redirect URI must match exactly, including http or https, the host, the port, and no trailing slash. `npm run dev` moves to port 3001 when port 3000 is busy; add that URI too, or free port 3000.
- "Error 401: invalid_client": the client ID or secret is wrong, or has stray spaces.
- RentBook says "That Google account isn't allowed": `ALLOWED_EMAIL` does not match the account you used.
- RentBook says "Can't load your Sheet": read the message under it. It names the problem, for example that the Sheets API is not enabled or the Sheet is not shared with the service account.

## 7. Deploy to Vercel

1. Sign in at https://vercel.com with GitHub, choose Add New, then Project, and import `vaibhavkannas/RentBook`.
2. Under Environment Variables add every name from step 6 (paste `GOOGLE_SERVICE_ACCOUNT_JSON` as one line, with no quotes). Use the test copy's `SHEET_ID` for the first deploy. Add them for Production and Preview.
3. Deploy. A first import deploys the production branch (`main`). Work on a branch gets its own preview URL until its pull request is merged.
4. Google does not accept wildcard redirect URIs. In Google Cloud, edit the OAuth client and add `https://<host>/api/auth/callback/google` for every host you sign in on: the preview URL now and the production URL later.
5. Open the URL on your phone, sign in, and use the browser menu's Add to Home Screen.
6. Switching to your live Sheet is a separate, later step: change `SHEET_ID` (and `SCHEDULE_TAB` if the tab name differs) in Vercel, then redeploy. Running deployments keep the old values. The end-to-end checklist in the implementation plan (Task 18) walks through it.

If sign-in fails with an `UntrustedHost` error (more likely with `npm start` than on Vercel), add the environment variable `AUTH_TRUST_HOST=true` and restart or redeploy.

## Rotating or revoking access

- To stop the app writing: remove the service account from the Sheet's sharing list.
- If the key file leaks: delete the key in Cloud Console (Service Accounts, Keys), create a new one, and update `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and `.env.local`. Redeploy after changing Vercel variables.
