# RentBook setup

One-time setup. Do steps 1 to 6 for local use, then step 7 to deploy.

Never commit secrets. `.env.local` is git-ignored. The service account key file stays outside the repo.

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
3. Move the file somewhere safe outside the repo. Treat it like a password.
4. Copy the `client_email` value from the file (it looks like `rentbook@<project>.iam.gserviceaccount.com`).

## 4. Share the Sheet with the service account

In the Sheet, click Share, paste the `client_email`, give it Editor access, and untick "Notify people". Share the test copy first.

## 5. Create the sign-in (OAuth) client

1. APIs & Services, then OAuth consent screen. Choose External. Fill in the app name and your email. Leave publishing status as Testing and add your own Google email under Test users.
2. APIs & Services, then Credentials, then Create credentials, then OAuth client ID, type Web application.
3. Under Authorized redirect URIs add `http://localhost:3000/api/auth/callback/google`.
4. Copy the client ID and client secret.

While the app is in Testing, Google shows an "unverified app" warning at sign-in. Click Advanced, then continue. Only the test users you added can sign in.

## 6. Create `.env.local`

Copy `.env.example` to `.env.local` and fill it in:

| Name | Value |
| --- | --- |
| `AUTH_SECRET` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | From step 5 |
| `ALLOWED_EMAIL` | The one Google account that may use the app |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The key file as one line. In PowerShell: `(Get-Content path\to\key.json -Raw \| ConvertFrom-Json \| ConvertTo-Json -Compress)` |
| `SHEET_ID` | From step 1 (the test copy) |
| `SCHEDULE_TAB` | Name of the tab that holds the month rows |
| `TOTAL_HEADER` | Exact header text of the monthly total column |

Check the Sheet before the first save: `npm run recon`. It only reads. Fix every problem it lists.

Run the app: `npm run dev`, then open http://localhost:3000.

## 7. Deploy to Vercel

1. Sign in at https://vercel.com with GitHub, choose Add New, then Project, and import `vaibhavkannas/RentBook`.
2. Under Environment Variables add every name from step 6 (paste `GOOGLE_SERVICE_ACCOUNT_JSON` as one line). Add them for Production and Preview.
3. Deploy. Note the production URL, for example `https://rentbook-xyz.vercel.app`.
4. Back in Google Cloud, Credentials, edit the OAuth client and add `https://<your-vercel-domain>/api/auth/callback/google` to the redirect URIs.
5. Open the URL on your phone, sign in, and use the browser menu's Add to Home Screen.

If sign-in fails with an `UntrustedHost` error, add the environment variable `AUTH_TRUST_HOST=true` and redeploy.

## Rotating or revoking access

- To stop the app writing: remove the service account from the Sheet's sharing list.
- If the key file leaks: delete the key in Cloud Console (Service Accounts, Keys), create a new one, and update `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and `.env.local`.
