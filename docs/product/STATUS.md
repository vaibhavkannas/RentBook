# RentBook v1.0: build status

Last updated: 2026-10-17, at the end of wave 2. Waves 3 to 5 are not started in this file's snapshot; this file is updated at the end of every wave.

## Where things are

Every wave is a branch stacked on the one before it, so the newest branch contains all the earlier work. Nothing has been merged to `main` or deployed. `main` is still at 845a252 (the live hike-rounding fix). An attempt to fast-forward `main` was blocked by the permission layer as a production deploy, and it was not worked around. The merge is yours to make (see "Owner steps").

| Branch | What it holds | Tip | Tests at the tip |
| --- | --- | --- | --- |
| `v1-wave-1b` | Wave 1 in full: data layer (1A) and server and security (1B) | d6a2130 | 79 files, 1,782 tests |
| `v1-wave-2` | Wave 1 plus wave 2 (app feel, items 8 to 13) | f02f900 | 117 files, 2,696 tests |

The baseline before this work was 1,420 tests. At every commit `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` were green, and the build passes with no sign-in settings in the environment.

## Scope

You selected: wave 1 (items 1 to 7), wave 2 (items 8 to 13), wave 3 (items 17, 20, 21, 22), wave 4 (items 25, 26, 27, 28), wave 5 (items 30, 31; item 29, CI, is done). Dropped: 14, 15, 16, 18, 19, 23, 24 (printable receipts and the WhatsApp share) and 32.

## Done, per task, with commit

Method: an implementer agent per sitting (test first, one commit per task), a separate review agent per sitting, one fix round, a scoped re-review of the fixes, and a final whole-branch review at the end of each part.

### Wave 1A: data layer (items 1 to 4 and 7)

| Task | What | Commit |
| --- | --- | --- |
| 29 | CI, Dependabot, Node version pin | 8a669f0 |
| 1A-1 | Month cells read one by one; unreadable ones reported inside the table | f3787c3 |
| 1A-2 | Month-ordering errors in words, with what to do | e109dbf |
| 1A-3 | Writes one at a time, re-check before cloning a month row, read back what was written | 4f1bd88 |
| 1A-4 | Missing or renamed tabs reported; Settings never reseeded over other tabs; start-up race survived | 968a03e |
| 1A-5 | Notes under Settings ignored; odd portion ids refused; portions keyed by Map | 0148af6 |
| 1A-6 | One Google read per page view; timeouts; "Google is limiting requests" and "Google isn't responding" messages | f6299ce |
| 1A-7 | Hike rounding in whole basis points; Replace checks what the warning named; dead code removed | aeea7ac |
| 1A fixes | Payments Log row kept when the read-back fails and never added twice; Settings reads hardened | 25a299f |

### Wave 1B: server and security (items 5 and 6)

| Task | What | Commits |
| --- | --- | --- |
| 1B-1 | Payments Log retry carries only a signed token; a replay never adds the row twice | 3a93c43 |
| 1B-2 | Signed "I just wrote" cookie; Activity and Settings cached for 15 seconds | 0bea9fd |
| 1B-3 | Requests must be the app's own JSON, same origin, under 32 KB, checked before the sign-in check | e787f7d |
| 1B-4 | Security headers, per-request nonce CSP (`CSP_REPORT_ONLY=1` emergency switch), not-found page, robots, `security.txt`; every page renders per request | ddb0237, 9c2faec |
| 1B-5 | 7-day sessions, `SESSION_NOT_BEFORE` sign-everyone-out switch, `AUTH_SECRET` length check, `emailVerified` required | 11b5d5c |
| 1B-6a | Control characters refused, dates limited to 2000 to 2100, `server-only` on server code, a test that every page and route asks who is signed in | ca540ef, 98a2788 |
| 1B-6b | One-line JSON logs with request ids, `/api/health`, plain error pages, undo and settings through the 30-second `postJson`, amount check | d9c211d, c829013, d160b9d, 3809a94 |
| 1B-7 | `SETUP.md` hardening, `SECURITY.md`, `docs/product/THREAT-MODEL.md` | fc25b62, e586ab1 |
| 1B-8a | The last raw `console` calls moved to the logger | 71cc6d8 |
| 1B final | Whole-branch review fixes: absolute 7-day session cap, Auth.js logging through the logger, ESLint `no-console`, caps on ids | d2ff3fa, d6a2130 |

### Wave 2: app feel (items 8 to 13)

| Task | What | Commits |
| --- | --- | --- |
| 2-1 | Design tokens, focus ring, press feedback, one brand module | 662bdf1 |
| 2-2 | Brand mark, full icon set with a maskable icon, favicon, manifest | 9c575ed |
| 2-3 | Shared pieces: Button, Field, Notice, Pill, Card and the rest | 648d8df |
| 2-4 | One bottom Sheet (focus trap, scroll lock) for the payment, undo and month dialogs | ccbd196, 8334ebb |
| 2-5 | The other screens on the shared pieces; branded sign-in | d8a12fc |
| 2-6 | Bottom tab bar, More screen, back that keeps the month | 3d96da8 |
| 2-7 | Toasts, pending states, loading skeletons | 50937bd, 1dfc2ad |
| 2-8 | Touch polish: safe areas, theme colour, 44 px targets | 51355c9 |
| 2-9 | Plain server messages, no field paths, `details.field` | f3663f4 |
| 2-10 | Friendlier forms: errors beside the field, phone keyboard hints, no-answer messages | bb24c0b, 59f2ab4 |
| 2-11 | Activity data: row meaning, grouping by day in India time, filters | db4d13e |
| 2-12 | Activity screen as a diary with filter chips | 0bb8c24 |
| 2-13 | Verification pass and README | 3339eb1 |
| Final fixes | Recovery wording, Activity searches the whole log, rupee sign kept with its number, docs corrected | 2cc52c3, 46c473a, 43e145d, f02f900 |

Plans: `docs/superpowers/plans/2026-10-14-v1-wave-1-trust.md` and `docs/superpowers/plans/2026-10-17-v1-wave-2-app-feel.md`.

## Not verified (could not be, in the cloud)

- **The write path against real Google.** Read-back, the Payments Log, undo and edit have only run against the in-memory fake. `npm run verify:testcopy` needs your `TEST_SHEET_ID` and credentials, which exist only on your laptop, and I never ran it.
- Real Google sign-in, and the Content Security Policy in a real browser on the live site (the nonce policy was checked in Chromium on a local build only).
- Safari, iOS (safe areas, status bar, focus return after closing a sheet), Firefox, an installed home-screen app (the exit guard), a screen reader, a real keyboard on Android, and the maskable icon crop on a device.
- Vercel itself: the deployment, `x-vercel-id`, the wording of its Sensitive-variable menu, and whether GitHub private vulnerability reporting, Dependabot and secret scanning are switched on.
- Real Google latency, and a Payments Log with hundreds of rows.

## Owner steps

1. Run `npm run verify:testcopy` against your test copy, from `v1-wave-1b` at least.
2. Before going live: your `AUTH_SECRET` must be at least 32 characters, or sign-in reports a configuration error. Set `AUTH_URL` in production. Switch on private vulnerability reporting in the GitHub repository settings (the link in `SECURITY.md` and `security.txt` needs it). Renew `Expires` in `public/.well-known/security.txt` by 2027-10-16.
3. Merge to `main` as fast-forwards, in order: `v1-wave-1b`, then `v1-wave-2` (each branch contains the ones before it, so one fast-forward to the newest branch brings everything). For example `git push origin v1-wave-1b:main`, later `git push origin v1-wave-2:main`. Roll back by promoting the previous Vercel deployment.
4. After deploying, check Google sign-in, one real payment (log and undo), and the browser console on the live site for Content Security Policy messages. If the policy blocks something, set `CSP_REPORT_ONLY=1` and redeploy: it reports instead of blocking.
5. Tell me if the gmail.com and googlemail.com addresses in `tests/server/env.test.ts` (they test the Gmail dot rule) and the made-up `*.iam.gserviceaccount.com` names in the Google client tests are acceptable under "example.com only".

## What changes for you and the people who use the app

- Sessions end 7 days after sign-in, however the cookie is renewed. You sign in again about weekly. A cookie from before this change can live up to about 14 days after the deploy; setting `SESSION_NOT_BEFORE` to the current time and redeploying cuts every older session at once. If you delete that variable later, cookies from before the cap can work again.
- Tenancy dates before 2000 are refused (the limit is 2000 to 2100).
- The new tenant name limit is 60 characters (the service already enforced it).
- A new look: house-and-ledger mark instead of the rupee glyph, new icons and favicon, a bottom tab bar (Month, Activity, More), Sign out and Portion settings now on the More screen, toasts after saves, skeletons while screens load.
- Buttons are a little heavier (font weight 500), disabled and saving buttons dim and show a spinner, text fields show a 2 px accent ring on tap, and the dim behind sheets is darker in dark mode.
- Settings labels are now "Payments per cycle" and "Hike at each new cycle (%)".
- Messages are plain English and name the field. When a screen is out of date they say "tap another tab at the bottom of the screen and come back".
- Activity is grouped by the day an entry was saved, in India time, with filters; it searches the whole log and shows the newest 50 matches.

## Known limits and deferred items

- Back and history: after Month, More, Settings, Month there is one extra history entry (More). Browsers without the Navigation API (Firefox) add one history entry per round trip. The phone's own Back button shows a screen as it was kept, so it can show an out-of-date screen; the tab bar and the back arrow refresh.
- On Android, closing the keyboard with Back usually leaves the field focused, so the tab bar stays hidden until the next tap elsewhere (unchecked on a device).
- The toast cannot be paused (4 seconds). Focus drops to the page after a save. Sheets cover the tab bar, so "tap another tab" in a message inside an open sheet asks for a hidden bar (one message says "Close this, then").
- A retry with no answer followed by a later refusal can read "not to the Payments Log" although the first retry may have saved.
- Next shows its own plain 500 page for a failure outside React rendering (the wording is not ours).
- Deleting `SESSION_NOT_BEFORE` later lets unstamped older cookies back in; `/api/auth/session` keeps renewing a cookie the app refuses (it shows no app data). Both can be closed by making the session callback refuse an expired session; deferred.
- The ESLint `no-console` rule misses deliberate evasions such as `globalThis` aliases. Next.js still prints some of its own errors, so treat Vercel logs as sensitive.
- Smaller items I left alone: a hack in `tests/support/render-open.ts` that forces forms open for rendering, no red border on invalid fields (the message under the field is the only signal), a 15 px un-dimmed strip beside a sheet on desktop browsers with classic scrollbars, some tests that read source text instead of running the component, a few wall-clock checks in `tests/support/fake-gateway.test.ts`, and the Portion filter on Activity listing every portion name ever logged, including renamed ones.

## Rulings made on your behalf

- `/api/health` stays a plain liveness check (`{ ok, version }`); the wave 3 setup and diagnostics pages will report configuration.
- Sessions without a recorded sign-in time keep working until they expire or are renewed once; renewing stamps them and the 7-day cap then applies.
- The wave 2 recovery wording: one shared phrase everywhere instead of "refresh the page", because the installed app has no refresh gesture.
- Re-reviews of two small doc and wording fix rounds were folded into the next whole-branch review.
