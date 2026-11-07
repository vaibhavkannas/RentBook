# RentBook v1 wave 5: tests and short guides (roadmap items 30 and a short 31)

> For agentic workers: implement task by task, test-first, with the gates below. One commit per task.

**Branch:** `v1-wave-5`, stacked on `v1-wave-4`. **Roadmap:** `docs/product/ROADMAP-v1.md` wave 5, owner-selected and lean: item 30 (screen tests and an on-demand end-to-end run) and a short item 31 (user guide, troubleshooting, README touch-up). **Tech:** Next.js 16.3.8, React 19, TypeScript strict, Tailwind 4, Vitest; Playwright only from outside the project.

**Goal:** every screen is rendered in tests through the real data path against the in-memory Sheet, in its main states, with landmark checks. One command drives a production build in Chromium at 390 px through the main journeys without touching Google. A person can learn the app and fix the common problems from two short docs. The app is not for sale: it only has to be polished as if it were.

**Out of scope:** licence, third-party notices, release tags or notes, changelog, limits page, marketing README, commercial or pen-test checklists, an admin guide beyond SETUP.md, rewriting SETUP.md, SECURITY.md or THREAT-MODEL.md, `docs/product/STATUS.md` (the controller updates it), e2e in CI, WebKit and Firefox.

**Builds on waves 3 and 4** as planned in the scratch files `plan-wave-3.md` and `plan-wave-4.md`. Use what landed under its real names. Where a screen, a copy text or a helper differs from those plans, follow the code and say so in the commit body.

## Global constraints

- This is not the Next.js you know (`AGENTS.md`). Before using a Next API, read its doc under `node_modules/next/dist/docs/` (tasks name the ones they need).
- Writes to Google stay RAW. No real email address anywhere in the repo (example.com only). Never read or print secrets. Never run `npm run verify:testcopy`. No push to main, no deploy.
- NO new dependencies (the only addition so far was `server-only`). No external fonts or icon packages, no CSS framework beyond the installed Tailwind 4, no test library beyond Vitest. UI tests use `react-dom/server` renders and source reading. Browser checks use the global Playwright (`/opt/node22/bin/playwright`, `/opt/node-tools/node_modules/playwright`, browsers in `/opt/pw-browsers`), never added to `package.json`.
- Every task is test-first (TDD) and ends with `npm test`, `npm run typecheck`, `npm run lint` and `env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npm run build` green (retry with `NODE_OPTIONS=--use-system-ca` on a certificate error). One commit per task; the message ends with a blank line and:
  `Claude-Session: https://claude.ai/code/session_01NEJMNwocTNcPN7LxPkW8Yx`
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Existing tests stay green. An old test changes only where a task says so; give the reason in the commit body.
- The owner's live behaviour and data must not change. Keep the Sheet layout, the auth, every page dynamic (`getViewer()` calls `connection()`) and the nonce CSP in `src/proxy.ts`.
- Plain English, phone first (360 to 430 px, 44 px targets), light and dark, accessible. Pure logic goes in `src/lib`, or in `scripts/e2e/helpers.ts` for the runner.
- Wave rules:
  - Production code changes only in 5-1 (the gateway seam, no change in behaviour) and in the CSS-only wrap fixes a long-name test exposes (5-3, 5-4).
  - A test that exposes a real bug: fix it in the same task when the fix is a few lines and plainly right; otherwise write `it.todo("… (bug: …)")` and list it in the report.
  - `package.json` gains only `"e2e": "tsx scripts/e2e/run.ts"`. A test pins that `package.json` and the lock file's `packages` have no `playwright`, `playwright-core` or `@playwright/test` entry (peer mentions inside other packages are fine).
  - Nothing under `src` imports from `tests/` or `scripts/`. No environment variable switches the real app to a fake: the in-memory Sheet reaches a build only through the e2e runner's temporary copy.
  - The e2e run never reaches Google. The copy uses the in-memory gateway, the env is dummy, and the browser aborts every request that is not to the local server (an attempt fails the run).

Sittings: A = 5-1 to 5-4 (seam and screen tests); B = 5-5 to 5-8 (e2e, docs, verify).

## Decisions the owner may want to override

1. **Seam:** a new one-function module `src/lib/server/gateway-source.ts` makes the gateway, and `context.ts` exports `buildSheetsContext(env, gateway)`. The e2e copy replaces only that module, so env parsing, named tabs and caches run as in production.
2. **E2E target:** a production build (`next build` + `next start`) of a temporary copy, Chromium only at 390×844. The sweep runs light and dark, the journeys light only. Here the build takes about 25 s, then 1 to 2 min of checks. It is not in CI (CI has no browser).
3. **Finding Playwright:** first `E2E_PLAYWRIGHT` (the folder of the `playwright` package; set but missing stops the run), then the global npm root, then `/opt/node-tools/node_modules/playwright`. The install hint is `npm install -g playwright` and `npx playwright install chromium`.
4. **node_modules in the copy is a hard-link tree**, copied instead across drives. A symlink makes `next build` fail ("Symlink [project]/node_modules is invalid, it points out of the filesystem root"; checked here on 2026-10-17). Linking 23,756 files took 0.4 s.
5. **One shared "world":** the in-memory Sheet is relative to today. Screen tests use it on a fixed day (2026-10-17), the e2e run on the real day.
6. **The docs are pinned by a test:** the first sentence of every message quoted in TROUBLESHOOTING must match the code, and every bold UI label in USER-GUIDE must exist in `src`.
7. **The temporary copy** is deleted after a passing run. It is kept, with failure screenshots, after a failing run or with `--keep`.

## The shared world (5-2)

`tests/support/worlds.ts`: `world(name, now)` returns `{ tabs }` for a FakeGateway. M is this month in India time; the Settings are the fixture `PORTIONS`. The `main` world:

| Portion | M-2 | M-1 | M | Tenants tab | Shows on M |
| --- | --- | --- | --- | --- | --- |
| p1 | Asha 2, ₹ 5,450 | Asha 3 | Asha 4 | current, agreement end today+30 | Paid; agreement "soon" |
| p2 | Bala 10, ₹ 12,700 | Bala 11 | — | current, no end | Pending, hike due: ₹ 13,335 |
| p3 | Chitra 4, ₹ 9,000 | — | — | current, agreement end today−7 | Pending; owes M-1 (and M from the 6th); "ended" |
| p4 | — | — | — | none | never let (Vacant) |
| p5 | Esha 1, ₹ 5,100 | Esha 2 | — | closed, move-out = 1st of M | Vacant since the 1st of M |

The other tabs of `main`: a Payments Log of eight rows 0 to 3 days ago in India time (Logged, Edited, Undone, by owner@example.com and member@example.com) plus one row a year old, and a Tenancy Log with Added p1, Edited p1 (Agreement end, Phone) and Moved out p5.

The other worlds: `empty` (every app tab with headers only, and a Schedule header with no months), `fresh` (only the Schedule tab of `main`), and `long` (`main` with a 60-character name for p1 and for Asha).

`withFaults(gateway, faults)` wraps any gateway; `faults()` gives `{ [method]: "unavailable" | "rate-limited" | "config" | "error" }`. A listed method throws `unavailable()`, `rateLimited()`, `configError("Google could not find that Sheet. Check SHEET_ID.")` or a plain Error. The screen tests and `scripts/e2e/sheet.ts` share it.

---

### 5-1 The gateway seam (no change in behaviour)

Files: new `src/lib/server/gateway-source.ts`, `src/lib/server/context.ts`, new `tests/server/gateway-seam.test.ts`.

- `gateway-source.ts`: `import "server-only"` and only `export function createGateway(env: AppEnv): SheetsGateway`, which returns `GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId)`.
- `context.ts`: `export function buildSheetsContext(env, gateway)` does all that `getSheetsContext` does after reading the env: wave 3's named-tabs wrapper, `withSnapshotCache`, the total header, the tab names. `getSheetsContext()` is the cached `buildSheetsContext(readEnv(process.env), createGateway(env))`. The other exports stay as they are.
- Tests: with `gateway-source` mocked to return a FakeGateway on `baseSchedule()`, `getSheetsContext()` returns the same object twice and `getMonthView` reads September 2026. Pin (captured before the edit): a log and an undo give the same `fake.calls` and grids as the old wiring. Source scans: `fromServiceAccount` is used in `src` only by `gateway-source.ts` and `google-gateway.ts`; no `src` file imports a path with `tests/` or `scripts/`; the package pin from the wave rules.
- Acceptance: existing tests pass unchanged; existing `vi.mock("@/lib/server/context")` users need no edit.

### 5-2 World, landmark checker and screen harness (test support only)

Files: new `tests/support/worlds.ts`, `tests/support/landmarks.ts` (each with a test), `tests/support/screens.ts`.

- `worlds.ts`, as above. Tests on 2026-10-17, 2027-01-03 (the year rolls over) and 2026-03-01 (the 1st): `loadSnapshot` parses every world with no problem; `deriveMonthView(M)` gives the table's statuses; the log rows fall on the right India days; p5 is vacant even on the 1st; `withFaults` throws each kind.
- `landmarks.ts`: `landmarkProblems(html, { main = true })` lists, in plain words:
  - not exactly one `<main` or one `<h1`, or a skipped heading level;
  - an `<a>` or `<button>` with no text, `aria-label` or `aria-labelledby`;
  - a text control (not hidden or submit) with no `<label for>`, wrapping `<label>` or aria name;
  - an `<img>` without `alt`, or an `<svg>` that is neither `aria-hidden="true"` nor `role="img"` with a name;
  - a duplicate `id`.

  Tests: one passing and one failing snippet per rule.
- `screens.ts`: `TEST_ENV` (complete dummy variables, example.com only, a canary in each secret) and `CANARIES`; `screenContext(worldName | tabs, { faults })` → `{ ctx, fake }`, built with the real `buildSheetsContext` and `withFaults`; the `OWNER` and `MEMBER` viewers; `FIXED_NOW = 2026-10-17T06:30:00Z`, used with `vi.useFakeTimers({ toFake: ["Date"] })`; `renderScreen(await Page(props))`. Its header comment holds the mock block each screen test file copies (vitest hoists `vi.mock` per file): `next/navigation` (redirect and notFound throw), `next/headers` (empty cookies and headers), `@/auth`, `auth-guard` (`getViewer` → `h.viewer`), and `@/lib/server/context` (the real module with `getSheetsContext: () => h.ctx()`).

### 5-3 Screen tests: the core screens

Files: new `tests/server/screens-core.test.ts`; CSS-only wrap fixes (`break-words`, plus `min-w-0` in a flex row) where a long name has none. Every render: `landmarkProblems` and `smallTargets` are empty, and there is no canary.

| Screen | States: what is asserted |
| --- | --- |
| Month `/` | normal: five cards in Settings order: p1 Paid, p2 Pending with ₹ 13,335, p3 Pending, p4 and p5 Vacant ("Vacant since 1 Oct 2026."); the summary is `summaryText`. `?month=2026-09`. empty: capture what the empty world shows, then pin it. error: `getManyValues` unavailable gives `LoadProblem` with that message and a Try again link that keeps the month. config: the owner gets the Set up link, a member `CONNECTION_NEEDS_ATTENTION`. long: the full names are shown and wrap |
| Activity | normal: day headings, sentences, "by you" on the owner's rows and the address on the member's; the action and portion filters. empty: "Nothing logged yet". No match: "No entries match these filters". error |
| More | owner and member rows, including those waves 3 and 4 added; a long email wraps |
| Portion settings | owner: a fieldset per switched-on portion; long names; error. A member is sent to `/` |
| Tenant `/tenants/p1`, `/tenants/p5` | current tenancy with chips, and Past tenants; p5 vacant since; the empty world's no-details text; an unknown id gives notFound; an unreadable Tenants tab shows its notice while the rest renders; error |
| Sign-in, error.tsx, global-error.tsx, not-found | landmark rules only (existing tests keep the copy) |

### 5-4 Screen tests: the wave 3 and 4 screens

Files: new `tests/server/screens-v1.test.ts`; CSS-only wrap fixes. The same rules on every render as in 5-3.

| Screen | States: what is asserted |
| --- | --- |
| `/setup` | owner, main: the all-OK headline. fresh: the Prepare card names the missing tabs. When `getSheetsContext` throws a config error, steps 3–6 say "Fix the settings above first.". member: the owner-only Notice and no checks |
| `/diagnostics` | owner, main: Reachable and the tab facts; Not reachable when `listTabs` fails; member Notice |
| Portion settings, wave 3 parts | p4 switched off (Settings H "No"): a Switched off section with Switch on; the Add a portion and Change order buttons; long names |
| `/overdue` | main: p3 ₹ 18,000 (September and October), then p2 ₹ 13,335; total ₹ 31,335. empty: "Nothing overdue". error. long names |
| `/year` | main 2026: 12 cells per portion; p1 paid August to October; p3 unpaid September and October; p5 vacant in October; November and December upcoming. 2025: "Nothing recorded for 2025". error |
| `/alerts` | main: p3 Ended ("Agreement ended 7 days ago, on 10 Oct 2026."), p1 "30 days left", p2 "Next payment". empty: both empty lines. error |
| Tenant History | p1: "Details changed for Asha." with "Phone number changed."; p5: the moved-out entry. empty: "No changes recorded yet.". A failing Tenancy Log read gives a warn Notice while the rest renders |
| Home, Needs attention | main, this month: the overdue, agreement and hike rows in order; no card on `?month=2026-09` or in the empty world |

### 5-5 E2E: in-memory Sheet, runner and page sweep

Read: `01-app/02-guides/testing/playwright.md`, `01-app/03-api-reference/06-cli/next.md`.
Files: new `scripts/e2e/sheet.ts`, `scripts/e2e/helpers.ts`, `scripts/e2e/run.ts`, `package.json` (the script only), tests `tests/server/e2e-sheet.test.ts` and `tests/server/e2e-helpers.test.ts`.

- `sheet.ts` goes into the copy unchanged; there `src/lib/server/gateway-source.ts` becomes the one line `export { createGateway } from "../../../scripts/e2e/sheet";`.
  - `createGateway(env: AppEnv)` makes ONE `withFaults(FakeGateway(world("main", new Date())))` and keeps it on `globalThis`, so every server bundle shares one Sheet.
  - Faults are read before each call from the JSON file `E2E_CONTROL` (`{ "fail": { method: kind } }`); a missing or unreadable file means none. It throws at once when `E2E_CONTROL` is unset.
  - Tests: each fault kind and clearing it, the shared instance, the refusal, and the same parameter count as the real `createGateway`.
- `helpers.ts` is pure and imports no Playwright:
  - `findPlaywright({ explicit, globalRoot, exists })` gives a path or "Playwright isn't installed. Install it outside this project with `npm install -g playwright`, then `npx playwright install chromium`, or set E2E_PLAYWRIGHT to the folder of the playwright package."
  - `dummyEnv(random)` → `{ env, canaries }`: a 64-character AUTH_SECRET; dummy AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET; `ALLOWED_EMAILS` "owner@example.com, member@example.com"; SHEET_ID "e2e-not-a-real-sheet"; a service account with `client_email` "e2e-sheets@example.com" and a dummy `private_key`; TOTAL_HEADER "Total Rent"; AUTH_TRUST_HOST "true".
  - `sessionCookie(email, secret, now)`: `encode` from `next-auth/jwt`, salt and cookie name `authjs.session-token`, token `{ name, email, sub, issuedAt: now }`. The test decodes it.
  - `COPY_LIST`: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src`, `public`, `tests/support`, `scripts/e2e/sheet.ts`.
  - `linkTree(from, to, link = fs.linkSync)`: hard links, a copy on `EXDEV` or `EPERM` (tested with a stub).
  - `report(results)` → `{ text, exitCode }`: "PASS  name (1.2 s)", "FAIL  name: reason. Screenshot: path", then "N passed, M failed."; exit 0 or 1 (a setup failure exits 2).
  - the minimal Playwright types that run.ts uses, so typecheck passes without Playwright.
- `run.ts`, run as `npm run e2e [-- --keep] [--only a,b] [--shots <dir>]`:
  1. Find Playwright, or exit 2.
  2. `mkdtemp(os.tmpdir())`; copy the `COPY_LIST`, link `node_modules`, write the gateway line, and check it is there.
  3. `next build` through `process.execPath node_modules/next/dist/bin/next`, with no auth env; on failure print the last 40 lines and exit 2.
  4. `next start` on a free port with `dummyEnv` and `E2E_CONTROL`; wait up to 30 s for `/api/health` to answer 200.
  5. Chromium contexts at 390×844 (isMobile, hasTouch), with owner and member cookies on `localhost`. Each context aborts and records non-local requests. Each page collects console errors, page errors and CSP violations (`addInitScript` listener plus `exposeFunction`). "Failed to load resource" is allowed only in checks that expect an HTTP error.
  6. Each check catches its own failure and saves a screenshot.
  7. Last: the server output holds no canary. Stop the server, print the report, delete the folder unless the run failed or `--keep` was given, and exit with its code.
- The `sweep` check visits `/`, `/?month=<M-1>`, `/activity`, `/more`, `/settings`, `/tenants/p1`, `/tenants/p5`, `/setup`, `/diagnostics`, `/overdue`, `/year`, `/alerts` and `/no-such-page`, as owner and as member, light and dark, plus `/signin` with no cookie. Each page must have the expected status, one `h1` and one `main`, `scrollWidth <= 390`, a nonce on every `<script>`, no console error, page error, CSP violation or blocked request, and no canary in the HTML. With `--shots`, each page is saved as a screenshot.
- Acceptance: `npm run e2e -- --only sweep` passes; `E2E_PLAYWRIGHT=/nonexistent npm run e2e` exits 2 with the message.

### 5-6 E2E: the journeys

Files: `scripts/e2e/run.ts` (and `helpers.ts` for any pure piece). Expected texts are imported from the src copy modules (`toast-copy.ts`, `undo-copy.ts`, `errors.ts`, `request-copy.ts`, the wave 3 and 4 copy), never typed again. The checks run in order on one server, so data carries over:

1. `load-error` (first, while every cache is empty): reads fail with unavailable, and Month, Activity and a tenant page show the message and Try again. Then config: the owner sees Set up, a member `CONNECTION_NEEDS_ATTENTION`. Clear the faults; Try again shows the cards.
2. `signin`: with no cookie, `/` goes to `/signin`. It shows the brand h1 and the "Sign in with Google" button (never pressed), and no tab bar.
3. `tab-bar`: on Month, Activity, More and the tenant page there are three tabs, `aria-current="page"` on the right one, and each is at least 44 px high.
4. `back-keeps-month`: from `/`, the previous-month arrow, then a card's tenant page, then the arrow back give `?month=<M-1>` and its heading. So do system Back, and the Activity tab followed by the Month tab.
5. `reports`: Needs attention, then Overdue rent, then p3's M-1 row, lands on that month; a Year cell lands on its month; Agreements and hikes shows Ended for p3 and Next payment for p2; More, then Set up, shows the all-OK headline, and Back returns to More.
6. `save-error`: `updateValues` fails with unavailable. Logging p3 shows the message in the sheet, the form unlocks, and p3 stays Pending. Clear the faults and cancel.
7. `log-existing`: log p2 at the suggested ₹ 13,335. The `logToastText` toast shows in the status region, and p2 is Paid.
8. `undo`: undo p2 and confirm. The undo toast shows, and p2 is Pending.
9. `duplicate-replace`: with the owner's page on M, the member logs p2 in its own context; the owner logs p2 at ₹ 13,000. The duplicate warning shows, Replace gives its toast, and a reload shows ₹ 13,000.
10. `new-tenant`: New tenant for p4, "Farah", ₹ 7,000. The toast shows, and the p4 card reads Farah, count 1, Paid.
11. `vacant`: the p5 card reads "Vacant since …". Add tenant opens New tenant with p5 chosen; cancel, and nothing is saved.
12. `edit-tenancy`: in Details on `/tenants/p1`, change the agreement end. "Details saved" shows, the new date shows, and History shows "Details changed for Asha.".
13. `move-out`: on `/tenants/p3`, Move out with today's date. The move-out toast shows, and the month it names shows p3 Vacant.
14. `activity-filters`: today's entries from checks 7 to 10 are listed. The Undone chip shows only "Undid" sentences and puts the filter in the address; then the p2 chip; Show everything resets both.
15. `settings`: in Portion settings, change p1's hike from 5 to 6. "Settings saved" shows, and a reload shows 6. A member who opens `/settings` lands on `/`.

Acceptance: the full run passes twice in a row; a failed check prints its reason and a screenshot path; the run takes under 4 minutes.

### 5-7 Short guides and README

Files: new `docs/USER-GUIDE.md`, new `docs/TROUBLESHOOTING.md`, `README.md`, new `tests/server/user-docs.test.ts`, and `tests/server/docs-claims.test.ts`, whose DOCS list gains both docs (deliberate). Plain language, no screenshots; waves 3 and 4 own their SETUP sections.

- **USER-GUIDE** (one to two pages, UI labels in bold), in this order:
  - signing in (owner and member); the month screen (pills, summary, switching months, Needs attention);
  - logging a payment (the count, the hike suggestion, changing the amount, the date received; "already logged" and Replace); undo; a new tenant; tenant details and moving out (vacant until New tenant; History);
  - Activity (days, chips, the newest 50); Overdue rent, Year at a glance, and Agreements and hikes, each rule in one paragraph from `OVERDUE_RULES` and the constants;
  - Portion settings (cycle, Count never resets, hike; adding, switching off, changing the order); Set up and Diagnostics; adding the app to the home screen.
- **TROUBLESHOOTING**: each message on its own `> "…"` line, then what to do. The messages come from the code: grep `src/lib/errors.ts`, `src/lib/sheets/google-errors.ts`, `src/lib/request-copy.ts`, `src/lib/server/problem.ts`, the sign-in page, the toast copy and the Sheet parsers.
  - **Start here:** Set up and Diagnostics for the owner; a member asks the owner; the server logs (JSON lines with `code` and request id, never a secret) and `/api/health`.
  - **Sign-in:** not on the list (`ALLOWED_EMAILS`, owner first, then redeploy); "Sign-in isn't set up correctly…" (AUTH_* and AUTH_URL; link SETUP's "If sign-in fails"); Google's redirect_uri_mismatch; "You've been signed out."; everyone signed out at once: SESSION_NOT_BEFORE (what it does and its format; an invalid value signs everyone out until it is fixed).
  - **The Sheet:** every google-errors message (share with the service account, API off, key rejected, .xlsx, SHEET_ID); a missing tab and the layout messages (Set up shows which); what members see.
  - **Saving:** Google limiting or not responding; no answer after 10 s; offline; page out of date; a request that didn't come from the app's page; the Payments Log retry notice; the vacant and switched-off refusals; a History entry not saved.
  - **CSP_REPORT_ONLY:** what it does, when to set it, and to delete it afterwards.
- **README** touch-up: the first line no longer says "five portions", and any bullet waves 3 and 4 made false is corrected. Add a Develop row for `npm run e2e` and a short "End-to-end check" paragraph (what it does; an in-memory Sheet, never Google; Playwright installed outside the project; not in CI because CI has no browser; the flags). Add a "Guides" list: USER-GUIDE, TROUBLESHOOTING, SETUP, SECURITY, THREAT-MODEL.
- SETUP.md, SECURITY.md and THREAT-MODEL.md: grep for statements waves 3 and 4 made false ("five portions", "Your Schedule is not changed", TOTAL_HEADER as required, "No tenant", the old tab list) and fix only those, each named in the commit body. SETUP's "If sign-in fails" gains one line linking TROUBLESHOOTING.
- Tests: the first sentence of each `> "…"` message matches some `src` file (`{…}` placeholders and the brand name match any text); each `**label**` in USER-GUIDE occurs in `src`; README links both guides, names `npm run e2e` and says it is not run in CI; the new docs hold no address other than example.com.

### 5-8 Verify

1. Gates: `npm test`, `npm run typecheck`, `npm run lint`, and the build with no auth env. Working tree clean. Note the test count before and after.
2. Run `npm run e2e -- --shots <scratch>/wave5-shots` twice; save the output to `<scratch>/e2e-run-1.txt` and `-2.txt` with the wall time. This is also the 390 px screenshot pass, in light and dark.
3. Negative checks: `E2E_PLAYWRIGHT=/nonexistent npm run e2e` exits 2 with the message. Mutation: change one button label in the working tree; `npm run e2e -- --only undo` exits 1 with a FAIL line and a screenshot; then `git checkout --` the file, and the tree is clean.
4. Check that neither `package.json` nor the lock file's `packages` has a Playwright entry, and that the wave's files hold no real email address.
5. Report: the test count, the checks and the run time; every deviation and the deliberate test change (the docs-claims list). Unverified: a run on the owner's Windows laptop (hard links on NTFS, `npm root -g`, path quoting); WebKit and iOS Safari; real Google (by design); real latency (the fake is instant); dark mode outside the sweep.
