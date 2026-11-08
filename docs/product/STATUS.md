# RentBook v1.0: build status

Last updated: 2026-11-08, at the end of the work: waves 1 to 5 are built, reviewed and pushed as branches. The merge to `main` was requested at the end of the work: see "Where things are" and `git log origin/main` for whether it has landed.

## Where things are

Every wave is a branch stacked on the one before it, so the newest branch, `v1-wave-5`, contains all the work. When this file was written nothing had been merged to `main` or deployed, and `main` was at 845a252 (the live hike-rounding fix). An early attempt to fast-forward `main` was blocked by the permission layer as a production deploy, and it was not worked around. The owner later asked for the merge to be made at the end of the work: check `git log origin/main` for whether it has landed, and see "Owner steps" if it has not.

| Branch | What it holds | Tip | Tests at the tip |
| --- | --- | --- | --- |
| `v1-wave-1b` | Wave 1 in full: data layer (1A) and server and security (1B) | d6a2130 | 79 files, 1,782 tests |
| `v1-wave-2` | Wave 1 plus wave 2 (app feel, items 8 to 13) | f02f900 | 117 files, 2,696 tests |
| `v1-wave-3` | Wave 2 plus wave 3 (setup, vacant units, add, switch off and reorder units, looser Sheet rules) | 5b105bc | 143 files, 3,967 tests |
| `v1-wave-4` | Wave 3 plus wave 4 (overdue, year view, alerts, change history) | 4e4e569 | 165 files, 4,763 tests |
| `v1-wave-5` | Wave 4 plus wave 5 (screen tests, end-to-end run, guides): the whole product | f4685d7, then this status update | 176 files, 5,262 tests |

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

### Wave 3: product setup (items 17, 20, 21, 22)

| Task | What | Commit |
| --- | --- | --- |
| 3-1 | Looser Sheet header matching; a Payments Log header that is not ours is never overwritten | 0392e9a |
| 3-2 | `TOTAL_HEADER` optional: with none set, no total column is written | d40016f |
| 3-3 | Tabs found by a forgiving match; the owner can name the app's own tabs | 7ab3358 |
| 3-4 | The environment checked in plain words; the problems the server logs are counted | 8dfbcf9, 5403778 |
| 3-5 | The owner's Sheet checked without writing, in plain words, with counts and times | 3fd1b52 |
| 3-6 | The Set up page and "Prepare my Sheet" | ac38f33 |
| 3-7 | The Diagnostics page, its rows, and a Set up link on a failed page | eec6024 |
| 3-8 | The vacancy rule; a vacant portion shows as Vacant, counts only let portions, and refuses a plain log for a vacant month | adb762d, 0ef57b5 |
| 3-9 | A portion is left cleanly vacant when its tenant moves out, including with no details | fab6137 |
| 3-10 to 3-12 | Active column in Settings; plan, write and reorder portions; owner-only routes and the Portion settings screen | 0628f9c, 7d085db, 2c363bc, 6013d4b, f72ea3d |
| 3-13 to 3-17 | Docs for Set up, Diagnostics, vacancy and the layout rules; fixtures | 8eed205, 70f65ed |
| Reviews and fixes | Switch-off no longer hides owed rent; settings saved under the write lock; Active-cell warnings; reorder as one range; a New tenant's closing no longer reads as a move-out; the final fix pass (what a portion change really writes over, the unpaid-rent scan, the Set up button on a warning, switched-off wording, New tenant refused on a switched-off portion) | ba3003e, 0fb52ea, 60cfd0b, e31671f, 5227ad4, afe2beb, 035f719, 15de7fa, ebacfe0, ae14947, b7b3df3, eba632a, ea22a65, b76848e, 5b105bc |

Plan: `docs/superpowers/plans/2026-10-17-v1-wave-3-product-setup.md`.

### Wave 4: features (items 25 to 28)

| Task | What | Commit |
| --- | --- | --- |
| 4-1 | Calendar-day helpers and the due-date rule (rent falls due on the 1st, overdue from the 6th) | d53bd23 |
| 4-2 | Overdue list: who owes what and since when, from the month cards | 0f85ae8 |
| 4-3 | Year view: each portion's twelve months with what was received | 54fe2bb |
| 4-4 | Agreement-end and rent-hike alerts, the home card's words, an "Agreement ended" chip | 7e3a555 |
| 4-5 | The Overdue rent screen (`/overdue`); every page reads the one cached snapshot | 8370cc1 |
| 4-6 | The Year at a glance screen (`/year`) and its link from the month summary | 3fcd630 |
| 4-7 | The Agreements and hikes screen (`/alerts`), the Needs attention card, More rows | 90edc2f |
| 4-8 to 4-10 | The Tenancy Log tab: a history row per changed field after every tenancy change, never able to fail the change itself, with one signed retry from the browser | a482b1f, 3880df9, d9255c5, 3fdb631 |
| 4-11 | History on the tenant page, from the Tenancy Log (cached 15 seconds, cleared by every write) | 9c6fa44 |
| 4-12 | Set up check, Diagnostics line, Prepare my Sheet and the docs for the Tenancy Log | f12a46e |
| 4-13 | Verification pass (nothing to change) | |
| Review fixes | Half-rupee shortfalls match the card; no hike alert for a month already vacant; moved-out hints; darker text in vacant year cells; a warning over the hikes when the Tenants tab cannot be read; the history write bounded to 3 seconds; the retry checks every row; an undo that opens a tenancy again is recorded in the Tenancy Log | ab5986d, 15e443d, 0103829, 6051879, 4e4e569 |

The wave 3 final fixes were merged into wave 4 by merge commit 7e56a06 (no rebase). Plan: `docs/superpowers/plans/2026-10-28-v1-wave-4-features.md`.

### Wave 5: tests and short guides (items 30 and a short 31)

| Task | What | Commit |
| --- | --- | --- |
| 5-1 | The Google gateway is made in one small module, so a test Sheet can replace it (no change in behaviour) | 69921f9 |
| 5-2 | A shared in-memory test world, a page-landmark checker and a screen harness (test support only) | bdc732b |
| 5-3 | Screen tests for the core screens, through the real data path; long names wrap | f844718 |
| 5-4 | Screen tests for the wave 3 and 4 screens; long names wrap | b4bd7f9 |
| 5-5 | `npm run e2e`: builds a temporary copy against an in-memory Sheet and sweeps every page in Chromium at 390 px, light and dark | a46d176 |
| 5-6 | The same run drives the main journeys (log, undo, replace, new tenant, vacant, edit, move out, filters, settings, errors) | 7338bf0 |
| 5-7 | `docs/USER-GUIDE.md`, `docs/TROUBLESHOOTING.md`, README touch-up | 60ac356 |
| 5-8 | Verification: two consecutive end-to-end runs passed (18 checks, about 55 seconds each with the build); the run was repeated after the fixes (18 passed, 53 seconds) | |
| Review fixes | Troubleshooting, README and SETUP corrections (the sign-in configuration error cannot be diagnosed from Set up; `SESSION_NOT_BEFORE` must be now or earlier), a stricter check that every bold label in the user guide is on a screen, and the end-to-end runner now cleans up its server and temporary copy on Ctrl-C and when killed | 8743f97, cd34e7c |
| Polish | The three small items the reviews had carried: card pill colours are tested by state, the tenant page's detail rows line up with their labels, and a Schedule with only its header row says what to do | f4685d7 |

The wave 4 final fix was merged into wave 5 by merge commit ea0c4c2 (no rebase). Plan: `docs/superpowers/plans/2026-11-03-v1-wave-5-tests-guides.md`.

Reviews: every wave had a final whole-branch review with the earlier slices reviewed one by one; no Critical finding was left open at the end of any of them. Waves 3 and 4 were also compared against the code before them on the same fixture Sheets, and your existing numbers and Sheet were identical apart from the documented changes.

## Not verified (could not be, in the cloud)

- **The write path against real Google.** Read-back, the Payments Log, undo and edit have only run against the in-memory fake. `npm run verify:testcopy` needs your `TEST_SHEET_ID` and credentials, which exist only on your laptop, and I never ran it.
- Real Google sign-in, and the Content Security Policy in a real browser on the live site (the nonce policy was checked in Chromium on a local build only).
- Safari, iOS (safe areas, status bar, focus return after closing a sheet), Firefox, an installed home-screen app (the exit guard), a screen reader, a real keyboard on Android, and the maskable icon crop on a device.
- Vercel itself: the deployment, `x-vercel-id`, the wording of its Sensitive-variable menu, and whether GitHub private vulnerability reporting, Dependabot and secret scanning are switched on.
- Real Google latency, and a Payments Log with hundreds of rows.
- Wave 3: a real Sheet with a tab renamed by the owner, the header-matching rules on the owner's real headers, the Active column (column H), adding, switching off and reordering portions on a real Sheet, and whether Google's multi-row and single-range writes behave as the in-memory fake does.
- Wave 5: the end-to-end run on your Windows laptop (hard links on NTFS, `npm root -g`, path quoting), WebKit and iOS Safari, and dark mode outside the page sweep. The run never touches Google by design, so it proves the app's screens and flows, not your Sheet.
- Wave 4: the Tenancy Log tab on a real Sheet (creation on first page view, the many-row append being all or nothing, its latency), the overdue and alert figures on years of real data, and history behaviour of the system Back button between the month, Overdue and Year screens (checked in Chromium on a scratch copy only).

## Owner steps

1. Run `npm run verify:testcopy` against your test copy, from `v1-wave-1b` at least, and again from `v1-wave-5` (the checks grew with waves 3 and 4).
2. Before going live: your `AUTH_SECRET` must be at least 32 characters, or sign-in reports a configuration error. Set `AUTH_URL` in production. Switch on private vulnerability reporting in the GitHub repository settings (the link in `SECURITY.md` and `security.txt` needs it). Renew `Expires` in `public/.well-known/security.txt` by 2027-10-16.
3. Merge to `main` as a fast-forward. Each branch contains the ones before it, so one push brings everything: `git push origin v1-wave-5:main`. To go step by step instead, push in this order: `v1-wave-1b` (waves 1A and 1B), `v1-wave-2`, `v1-wave-3`, `v1-wave-4`, `v1-wave-5`, each as `git push origin <branch>:main`. Roll back by promoting the previous Vercel deployment. I did not push to `main`: that was blocked as a production deploy and you decide it.
4. After deploying, check Google sign-in, one real payment (log and undo), and the browser console on the live site for Content Security Policy messages. If the policy blocks something, set `CSP_REPORT_ONLY=1` and redeploy: it reports instead of blocking.
5. Before first using the app after the wave 4 deploy: the first page view adds an empty "Tenancy Log" tab to your Sheet. If your Sheet already has an unrelated tab with that name, rename it first or set `TENANCY_LOG_TAB`. In the same way, if you use a custom tab name for any app tab, rename the tab in the Sheet first: Prepare my Sheet or the first page view would otherwise create new tabs with default cycle and hike values.
6. Before using "Switch off" on a portion: clear any old closed Tenants rows left by a New tenant of the same name or one that was undone, make sure Settings cell H1 and column H are empty, and on the test copy try appending a column, a single-range reorder, clearing a Move-out cell with a raw empty value, a checkbox rule in column H, and case-insensitive tab titles. Then run `npm run verify:testcopy` again.
7. Tell me if the gmail.com and googlemail.com addresses in `tests/server/env.test.ts` (they test the Gmail dot rule) and the made-up `*.iam.gserviceaccount.com` names in the Google client tests are acceptable under "example.com only".

## What changes for you and the people who use the app

- Sessions end 7 days after sign-in, however the cookie is renewed. You sign in again about weekly. A cookie from before this change can live up to about 14 days after the deploy; setting `SESSION_NOT_BEFORE` to the current time and redeploying cuts every older session at once. If you delete that variable later, cookies from before the cap can work again.
- Tenancy dates before 2000 are refused (the limit is 2000 to 2100).
- The new tenant name limit is 60 characters (the service already enforced it).
- A new look: house-and-ledger mark instead of the rupee glyph, new icons and favicon, a bottom tab bar (Month, Activity, More), Sign out and Portion settings now on the More screen, toasts after saves, skeletons while screens load.
- Buttons are a little heavier (font weight 500), disabled and saving buttons dim and show a spinner, text fields show a 2 px accent ring on tap, and the dim behind sheets is darker in dark mode.
- Settings labels are now "Payments per cycle" and "Hike at each new cycle (%)".
- Messages are plain English and name the field. When a screen is out of date they say "tap another tab at the bottom of the screen and come back".
- Activity is grouped by the day an entry was saved, in India time, with filters; it searches the whole log and shows the newest 50 matches.
- Wave 3: owner-only Set up and Diagnostics pages (reached from More, and from a failed page) say in plain words what is wrong with the settings or the Sheet; "Prepare my Sheet" adds missing app tabs. Sheet headers are matched more loosely, `TOTAL_HEADER` is optional, and the app's own tabs can have other names. A portion whose tenant moved out shows as Vacant, and Portion settings can add a portion, switch one off (history stays) and change the order.
- Wave 4: a Needs attention card on the month screen, and three new screens under More: Overdue rent (who owes what and since when; rent is due on the 1st and counts as overdue from the 6th), Year at a glance (each portion's twelve months and totals) and Agreements and hikes (agreements ending within 60 days or ended, and rent hikes due within two months). The tenant page gains a History section, fed by a new "Tenancy Log" tab that the app adds to your Sheet and appends to after every tenancy change made in the app.
- Wave 5: `docs/USER-GUIDE.md` and `docs/TROUBLESHOOTING.md`, and `npm run e2e` for a developer (Playwright installed outside the project).

## Known limits and deferred items

- Wave 3: a New tenant corrected by a second New tenant of the old name with Replace leaves the old tenancy closed, so the portion shows Vacant with "Add tenant"; adding details for the same name ends the vacancy. A move-out recorded without details cannot be undone in the app. After a switch-off an old gap month keeps its pending card, so it stays in what is due until logged or the Schedule is edited. Typed (non-formula) totals go stale when `TOTAL_HEADER` is not set. On a switched-off card with no details the link reads "Tenant page".
- Wave 4: a card measures a month against the payment before it, so an extra payment lifts the next month's reference rent and the next month can read "less than rent"; the overdue list and year view agree with the card (the card rule is unchanged). A blank tenant cell is a name of its own and ends a tenant's run. A portion whose tenant left without a recorded move-out shows long arrears, a hike and an ended agreement until the move-out is recorded (the screens say so). A hike alert is not hidden for a move-out recorded for a future day until that month is vacant. The year grid can show an unpaid month of an earlier tenant that the overdue list ignores. `/year?year=2099` shows a grid of "Not due yet" cells. A New tenant that fails halfway writes no history. The browser's one automatic retry of a history write is not awaited: a full page reload before it finishes loses that row without a message, and the page does not refresh after a successful retry. A History entry's time shows no year. A Sheet that has a "Tenancy Log" tab but no Settings tab is refused with "Settings tab is missing". A history write that gave up after 3 seconds can still land just before its retry looks, which would add the rows twice (accepted, as the Payments Log has the same property). A save that changes more than 12 history rows gets no retry token, and nothing checks a token against the retry route's 4,000-character body limit. A New tenant's payment now has up to 3 seconds more inside one lock and the 15-second request limit (the risk predates the wave).
- Wave 5: a runner killed with SIGKILL cannot delete its temporary copy under `/tmp` (a watchdog ends its server and browser; remove the `rentbook-e2e-*` folder by hand). In a production build a sign-in configuration error reaches the server log as `code: "internal"`, not the configuration code, because the instrumentation hook and the pages load separate copies of the error class; the log line still names each missing setting and never a value.

- Back and history: after Month, More, Settings, Month there is one extra history entry (More). Browsers without the Navigation API (Firefox) add one history entry per round trip. The phone's own Back button shows a screen as it was kept, so it can show an out-of-date screen; the tab bar and the back arrow refresh.
- On Android, closing the keyboard with Back usually leaves the field focused, so the tab bar stays hidden until the next tap elsewhere (unchecked on a device).
- The toast cannot be paused (4 seconds). Focus drops to the page after a save. Sheets cover the tab bar, so "tap another tab" in a message inside an open sheet asks for a hidden bar (one message says "Close this, then").
- A retry with no answer followed by a later refusal can read "not to the Payments Log" although the first retry may have saved.
- Next shows its own plain 500 page for a failure outside React rendering (the wording is not ours).
- Deleting `SESSION_NOT_BEFORE` later lets unstamped older cookies back in; `/api/auth/session` keeps renewing a cookie the app refuses (it shows no app data). Both can be closed by making the session callback refuse an expired session; deferred.
- The ESLint `no-console` rule misses deliberate evasions such as `globalThis` aliases. Next.js still prints some of its own errors, so treat Vercel logs as sensitive.
- Smaller items I left alone: a hack in `tests/support/render-open.ts` that forces forms open for rendering, no red border on invalid fields (the message under the field is the only signal), a 15 px un-dimmed strip beside a sheet on desktop browsers with classic scrollbars, some tests that read source text instead of running the component, a few wall-clock checks in `tests/support/fake-gateway.test.ts`, and the Portion filter on Activity listing every portion name ever logged, including renamed ones.

## Rulings made on your behalf

- Wave 3: `/api/health` stays a plain liveness check; the Set up and Diagnostics pages report configuration. A portion's tenant leaving is detected by the tenant's name. Wave 4: rent is due on the 1st and overdue from the 6th; lists never disagree with the month cards; the Tenancy Log never blocks a tenancy change and is never read with the snapshot.
- Wave 5: the guides are short and plain; there is no licence, release, limits page or marketing text. The end-to-end run is not part of CI (CI has no browser) and Playwright stays outside the project. A mistaken change is recorded in the Tenancy Log only for edits made in the app, not for edits made straight in the Sheet.
- `/api/health` stays a plain liveness check (`{ ok, version }`); the wave 3 setup and diagnostics pages report configuration.
- Sessions without a recorded sign-in time keep working until they expire or are renewed once; renewing stamps them and the 7-day cap then applies.
- The wave 2 recovery wording: one shared phrase everywhere instead of "refresh the page", because the installed app has no refresh gesture.
- Re-reviews of two small doc and wording fix rounds were folded into the next whole-branch review.
