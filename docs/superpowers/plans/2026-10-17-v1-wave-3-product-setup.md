# RentBook v1 wave 3: product setup (roadmap items 17, 20, 21, 22)

> For agentic workers: implement task by task, test-first, with the gates below. One commit per task.

**Branch:** `v1-wave-3`, stacked on `v1-wave-2`. **Roadmap:** `docs/product/ROADMAP-v1.md`, wave 3, the owner-selected items only: 17 setup and health-check pages, 20 vacant units, 21 add / switch off / reorder portions, 22 looser Sheet layout rules. **Tech:** Next.js 16.3.8, React 19, TypeScript strict, Tailwind 4, Vitest, zod, `@googleapis/sheets`.

**Goal:** a new owner connects RentBook to their own Sheet from a guided, owner-only `/setup` page and watches it from `/diagnostics`; a portion with no tenant is a normal "Vacant" state that costs nothing in the month's totals; the owner adds, switches off and reorders portions from the app; Sheets laid out a little differently from the owner's still work. The owner's live Sheet keeps working exactly as today except where a task says so.

**Out of scope:** the Config tab, currency/locale/time zone, dynamic manifest, app name or accent colour, owner-specific default portion names (`DEFAULT_PORTION_NAMES`), demo mode, CSV export, receipts, WhatsApp share, vacancy alerts, the overdue list and year view (wave 4: they must use the card status from 3-8, so vacant portions stay out), the full SETUP.md rewrite (only the sections this wave touches), wave 5.

**Builds on wave 2** (`docs/superpowers/plans/2026-10-17-v1-wave-2-app-feel.md`): reuse `Button`/`ButtonLink`/`SubmitButton`, `Field` and its controls, `Notice`/`LiveNotice`, `Pill`, `Card`, `Sheet`, `EmptyState`, `Page`/`PageHeader`/`BackLink`, `useToast` and `toast-copy.ts`, `sendJson` and `request-copy.ts` (`apiErrorMessage`), `form-errors.ts`, `app-nav.ts` (`tabForPath`), the More page, `smallTargets` and `design-system.test.ts`. Invent no new primitive; if one is truly missing, add it under `src/components/ui/` with a test.

## Global constraints

- This is not the Next.js you know (`AGENTS.md`). Before using a Next API read its doc under `node_modules/next/dist/docs/` (tasks name the ones they need). `src/proxy.ts` is the old middleware.
- Writes to Google stay RAW. No real email address anywhere in the repo (example.com only). Never read or print secrets. Never run `npm run verify:testcopy`. No push to main, no deploy.
- NO new dependencies (the only addition so far was `server-only`). No external fonts or icon packages, no CSS framework beyond the installed Tailwind 4, no test library beyond Vitest. UI tests use `react-dom/server` renders and source reading (see `tests/server/ui-smoke.test.ts`, `tests/server/client-requests.test.ts`); browser checks may use the global Playwright (`/opt/node22/bin/playwright`, browsers in `/opt/pw-browsers`, Chromium) from a scratch dir, never added to `package.json`.
- Every task is test-first (TDD) and ends with `npm test`, `npm run typecheck`, `npm run lint` and `env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npm run build` green (the build must pass with no auth environment; retry with `NODE_OPTIONS=--use-system-ca` on a certificate error). One commit per task; the message ends with a blank line and:
  `Claude-Session: https://claude.ai/code/session_01NEJMNwocTNcPN7LxPkW8Yx`
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Existing tests stay green. An old test changes only where a task below says the behaviour changes on purpose; say why in the commit body.
- The owner's live behaviour and data must not change except where a task says so. Keep the current Sheet layout working, the current auth, every page dynamic (`getViewer()` calls `connection()`), and the nonce CSP in `src/proxy.ts` (no inline scripts, no `<style>` blocks; inline `style` attributes and inline `<svg>` are allowed).
- Plain English, phone first (360 to 430 px, thumb reach, 44 px targets), light and dark, accessible (labels, visible focus, contrast, `aria-live` for status). Pure logic in `src/lib` with unit tests; components stay thin.
- Wave rules:
  - `/api/health` does not change (it answers only `{ ok, version }`); `tests/server/health.test.ts` is not edited.
  - `/setup` and `/diagnostics` never show a secret, a key, a token, an environment value or tenant data (names, phones, amounts). Allowed: tab titles, header texts, counts, times, and the service account's `client_email` (the address the Sheet must be shared with; the "Share the Sheet with …" error already shows it to the owner).
  - Every Sheet change in this wave runs inside `withWriteLock`, reads fresh (never the cache), writes RAW through `updateValues`, reads back what it wrote, and calls `invalidateCaches` in `finally`. Structural calls (`addTab`, the new `ensureColumnCount`) are never retried. Nothing deletes a row, a column, a tab, or a value it did not write.
  - Every new page or route that uses the Sheet exports `maxDuration = 15`; every new route runs `readJsonBody` before `requireOwner`/`requireUser`, inside `handle()`, and writes through `runWrite`.

Suggested sittings (one implementer each): 3-1 to 3-3, 3-4 to 3-7, 3-8 to 3-10, 3-11 to 3-13, 3-14 to 3-17.

## What must not change for the owner, and the test that pins it

| Behaviour | Pinned by |
| --- | --- |
| Each portion maps to the same Schedule columns as today | 3-1: fixture Sheet maps to hard-coded column indexes |
| Totals written exactly as today when `TOTAL_HEADER` is set | existing `write-safety` and service total tests, unchanged |
| Default tab names: every Google call carries the same tab names | 3-3: call log through the wrapper equals the call log without it |
| Settings with a blank `H1`: every portion active | 3-11: "No" typed in H3 under a blank H1 changes nothing |
| A Sheet with no move-outs in its Tenants tab: same month views | 3-8: hard-coded statuses, counts, due and received for Aug 2026 to Jan 2027 |
| Payments Log with current headers: no write | existing `settings-store.test.ts` "writes nothing when the headers are already current" |
| `/api/health` | `health.test.ts`, untouched |

## Decisions the owner may want to override

1. **Vacancy rule** (3-8): a portion is vacant in a month when its last tenant's move-out date in the Tenants tab is on or before the 1st of that month. Moving out on the 1st makes that month vacant; any later day leaves that month due. It needs a move-out record whose tenant name matches the Schedule's last tenant (3-10 lets the owner record one without adding details first).
2. **Labels** (3-9): the "No tenant" pill becomes "Vacant", and the month summary counts only let portions ("3 of 4 portions · 1 vacant" where today it says "3 of 5 portions").
3. **Refusals** (3-9, 3-10): a plain "Log payment" for a vacant month is refused (add the new tenant with New tenant), and a move-out date before a month that already has the tenant's rent is refused.
4. **Switch off, never delete** (3-11): a portion is switched off with a new Settings column H headed "Active" ("No" = off). This is allowed only once the portion is vacant. Its history stays. Deleting a portion stays a by-hand job.
5. **New portion columns** (3-12) go to the right of everything already used in the Schedule (so after the Total column), named `Tenant6`/`Count6`/`Amount6` in the style of the existing headers. The app never edits a Total formula: it tells the owner which column to add to it.
6. **`TOTAL_HEADER` becomes optional** (3-2). When it is unset, no total column is written, and the app does not guess one. 3-3 adds optional `SETTINGS_TAB`/`LOG_TAB`/`TENANTS_TAB` names and case-insensitive tab matching; drop 3-3 if fixed tab names are preferred.

## The Sheet layout today (item 22 audit) and what this wave changes

| Rule today | Where | After this wave |
| --- | --- | --- |
| Schedule tab named exactly `SCHEDULE_TAB` (default "Schedule") | `ensureTabs` | Exact name first, then a unique case/space-insensitive match (3-3) |
| A "Month" header in the first 25 rows; headers matched trimmed, any case | `schedule.ts` | Also ignores inner double spaces, no-break and zero-width spaces (3-1) |
| Each Settings portion's Tenant/Count/Amount header appears once in the header row | `parseSchedule` | Kept, with the looser matching. Columns of a switched-off portion may be deleted (3-11) |
| `TOTAL_HEADER` required, found once | `env.ts`, `parseSchedule` | Optional (3-2) |
| Month cells readable, months in order, the row under the last month empty, columns A:ZZ | `parseSchedule`, `ensureMonthRow` | Kept (clear errors exist) |
| First run: `Tenant N` immediately followed by `Count N`, `Amount N` | `inferPortions` | Other columns may sit between them; the order stays (3-1) |
| Settings: columns A–G, header row 1, rows 2–50, id pattern, cycle/hike types, notes ignored | `settings-store.ts` | Kept; plus column H "Active" (3-11) and a clear error for duplicate ids (3-1) |
| Payments Log by position A–I; H1:I1 overwritten when different | `ensureTabs` | Only blank header cells are filled (3-1) |
| Tenants: the 15 headers in A–O, exact text (trimmed) | `tenants-store.ts` | Same order; case and inner spaces ignored (3-1) |
| App tab names fixed ("Settings", "Payments Log", "Tenants") | constants | Optional env names (3-3) |

`src/lib/layout-rules.ts` (3-6) holds the rules that remain, in plain words, for `/setup` and SETUP.md.

---

### 3-1 Header matching and safer header writes (item 22)

Files: new `src/lib/sheets/headers.ts`, `schedule.ts`, `settings-store.ts`, `tenants-store.ts`, tests (new `tests/sheets/headers.test.ts`, additions to `schedule.test.ts`, `settings-store.test.ts`, `tenants-store.test.ts`).

- `headerKey(value)`: `String(value ?? "")`, NFKC, drop U+200B–U+200D and U+FEFF, each whitespace run (no-break spaces included) becomes one space, trim, lower-case.
- `findHeader(headers, name)` returns `{ index }` or `{ problem: "missing" | "duplicate" }`. It tries today's rule (trim + lower-case) first, and only when that finds nothing, `headerKey`. A header that matched before still matches the same column, and a duplicate the old rule did not see is never newly reported.
- `findColumn` and `findHeaderRowIndex` use these helpers. A missing-header message keeps its sentence and adds ` Check the spelling in the Schedule header row (row N) and in the Settings tab.`
- `inferPortions` (first run only) pairs `Tenant N` with the next `Count N`, then the next `Amount N` with the same number, before the next Tenant header; other columns may sit between them. These stay refused: a Tenant-looking header it cannot read ("Tenant (1F double)"), the wrong order (`["Month","Tenant","Amount","Count"]`) and duplicates.
- Settings: two rows with the same id (case-insensitive) → `Settings rows 3 and 6 both use the portion id "p2". Give each portion its own id.`
- Tenants headers are compared with `headerKey`, still by position A to O; the message is unchanged.
- Payments Log upgrade: H1 and I1 are compared with `headerKey`. Only blank cells are filled. A cell holding other text is left alone, logged once with `logEvent("warn", "payments-log-header-taken", …)`, and reported by `/setup` (3-5).
- Tests:
  - `headerKey` cases;
  - `["Count 2", "Count  2"]` finds the exact one with no duplicate error;
  - a "Phone2" column between Tenant2 and Count2 at first run;
  - duplicate ids;
  - Tenants header "move-in  DATE" accepted;
  - Log H1 "Comments" kept while a blank I1 is filled;
  - pin: the fixture Sheet maps p1 to p5 to hard-coded column indexes.
- Acceptance: every existing test passes unchanged.

### 3-2 Optional TOTAL_HEADER (item 22)

Files: `src/lib/server/env.ts`, `src/lib/server/context.ts`, `src/lib/sheets/schedule.ts`, `service.ts`, `recon.ts`, `scripts/recon.ts` and `scripts/verify-testcopy.ts` (types only), tests.

- `readEnv`: `TOTAL_HEADER` is no longer required; `totalHeader: string | null` (blank = null). `SheetsContext.totalHeader` and `parseSchedule(values, portions, totalHeader)` accept null, and then `layout.totalCol` is null. A header that is configured but missing is still an error.
- With no total column: `totalIsFormula` is not called, and no total cell is written or read back. A new month row already blanks typed values. With a total column nothing changes.
- recon reports "no total column".
- Deliberate test change: `env.test.ts` "lists every missing variable together" no longer lists `TOTAL_HEADER`.
- Tests: env without the variable gives null. With `totalHeader: null`, log, undo and a new month write only the three portion cells (fake call log plus a grid diff). The existing typed-total and formula-total tests (the owner's path) stay unchanged.

### 3-3 Tab names: forgiving match, optional names for the app tabs (item 22)

Files: new `src/lib/sheets/named-tabs.ts`, `env.ts`, `context.ts`, `src/lib/errors.ts` (`tabMissing` also carries `details: { tab }`), tests (new `tests/sheets/named-tabs.test.ts`, env tests).

- Env: optional `SETTINGS_TAB`, `LOG_TAB`, `TENANTS_TAB` (defaults "Settings", "Payments Log", "Tenants"), trimmed, 1–100 characters. All four names, including `SCHEDULE_TAB`, must differ by `headerKey`, or a config error says: "SCHEDULE_TAB, SETTINGS_TAB, LOG_TAB and TENANTS_TAB must each name a different tab."
- `NamedTabsGateway implements SheetsGateway` wraps the Google gateway in `getSheetsContext`. The app keeps its logical names.
  - Finding a real title: the tab whose title equals the configured name; else the single tab whose `headerKey` equals it; else none (two candidates also count as none: never guess).
  - `listTabs` returns the logical name for each tab found and leaves out any other tab whose title is an app tab's logical name. So the owner's own "Tenants" tab is never taken for RentBook's when `TENANTS_TAB` points elsewhere. Other titles pass through.
  - Every method maps tab names; unknown names pass through. The map is cached and forgotten after `addTab` and after an AppError carrying `details.tab`. On that error the wrapper also calls `resetBootstrap(this)` (the Google gateway only resets itself). `realTitles()` gives `/setup` the real names.
- Tests:
  - identity pin: log, edit, undo, saveTenancy and move-out through the wrapper (default names) and through the bare fake give the same `fake.calls`, the same tab names and the same grids;
  - "schedule" is found for "Schedule";
  - two case variants count as missing;
  - with `TENANTS_TAB="RentBook Tenants"` and an unrelated "Tenants" tab, `ensureTabs` creates "RentBook Tenants" and never touches "Tenants";
  - a tab-missing error resets the wrapper's bootstrap.

### 3-4 Environment checks and problem counts (item 17)

Files: new `src/lib/setup-checks.ts` (pure, client-safe), new `src/lib/server/setup-env.ts`, `src/lib/server/log.ts`, tests (`tests/domain/setup-checks.test.ts`, `tests/server/setup-env.test.ts`, `tests/server/log.test.ts`).

- Types and helpers:
  - `Check = { id; step: 1|2|3|4|5|6; title; status: "ok"|"warn"|"fail"|"todo"|"skip"; detail; fix? }`.
  - `SETUP_STEPS`: 1 Sign-in, 2 Google service account, 3 Your Sheet, 4 Schedule tab, 5 RentBook's tabs, 6 Portion settings.
  - `stepStatus(checks, step)` is the worst status in the step.
  - `headline(checks)`: "Everything is connected." / "Your Sheet needs preparing." (only todo) / "1 thing to fix." / "{n} things to fix." (fail plus warn).
  - `statusPill(status)`: ok success "OK"; warn warn "Check"; fail danger "Fix"; todo neutral "To do"; skip neutral "Waiting".
- `envChecks(env)` never puts a value in a check, except the service account address:

  | Variable (step) | Fine | Problem → "To fix" |
  | --- | --- | --- |
  | `AUTH_SECRET` (1) | Set. | Not set. / Shorter than 32 characters. → Make a random string of at least 32 characters (SETUP.md step 6) and set AUTH_SECRET. |
  | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (1) | Set. | Not set. → Copy it from your sign-in (OAuth) client in Google Cloud (SETUP.md step 5). |
  | `AUTH_URL` (1) | Not set: fine on your own computer. / Set. | warn: Set but empty, which turns off the host check. → Delete the line. fail: Not a plain web address. → Use the app's address only, such as https://rentbook.example.com, with no path. |
  | `ALLOWED_EMAILS` (1) | {n} addresses. The first is the owner. | warn: Only the older ALLOWED_EMAIL is set. → Move to ALLOWED_EMAILS (SETUP.md). |
  | `SESSION_NOT_BEFORE` (1) | Not set. / Set: sign-ins from before it are refused. | Not a date and time, so everyone is signed out. → Use the form 2026-10-16T10:00:00Z, or delete it. |
  | `CSP_REPORT_ONLY` (1) | Not set: the security policy is enforced. | warn: On: the browser only reports what the security policy would block. → Delete it and redeploy once the problem is fixed. |
  | `GOOGLE_SERVICE_ACCOUNT_JSON` (2) | Set. The service account is {client_email}. | Not set. → Paste the key file as one line (SETUP.md step 6). / Not valid JSON. → Paste it as one line, without quotes around it. / Not a service account key: client_email or private_key is missing. → Create a JSON key (SETUP.md step 3). |
  | `SHEET_ID` (3) | Set. | Not set. → Copy the ID from the Sheet's address (SETUP.md step 1). / Looks like a whole address. → Use only the part between /d/ and /edit. |
  | `SCHEDULE_TAB`, `TOTAL_HEADER` (4); `SETTINGS_TAB`, `LOG_TAB`, `TENANTS_TAB` (5) | Not set, so "{default}" is used. / Set. (TOTAL_HEADER unset: "Not set: no total column is kept up to date.") | Two names the same. → Give each a different tab. |

- `log.ts`: count every warn and error line by `code ?? event` since the module loaded. `problemCounts()` returns `{ since, warn: Record<string, number>, error: Record<string, number> }`. Info lines are not counted, and nothing printed changes.
- Tests: each table row. A canary value in every variable never appears in `JSON.stringify(envChecks(env))`; only the `client_email` does. Counts rise per level and code.

### 3-5 Read-only Sheet checks and facts (item 17)

Files: new `src/lib/sheets/sheet-checks.ts`, test `tests/sheets/sheet-checks.test.ts`.

- `checkSheet(gateway, { scheduleTab, totalHeader }, clock = performance.now)` returns `{ checks, facts }`. It never calls `ensureTabs` or any write, and makes three calls:
  1. `listTabs`, timed;
  2. ONE `getManyValues` (UNFORMATTED, timed) over the tabs that exist: Settings `SETTINGS_RANGE`, Schedule `A1:ZZ`, Payments Log `A1:I`, Tenants `TENANTS_RANGE`;
  3. ONE `getValues` FORMULA of `A{last}:ZZ{last+1}`, which gives the total cell and the row under the table.
- `facts`: `{ listMs, readMs, monthRows, firstMonth, lastMonth, portionsOn, portionsOff, logRows, lastSavedAt, tenantsRows, openTenancies, lastUpdatedAt }`. Counts and times only.
- Each part is checked on its own:
  - `parseSchedule(values, [], null)` for months;
  - `findHeader` for the total;
  - `parseSchedule(values, portions, null)` for the portion columns.

  | id (step) | ok | problem → To fix |
  | --- | --- | --- |
  | connection (3) | RentBook can open your Sheet ({ms} ms). | the gateway's translated message (share with {client_email}, API off, wrong SHEET_ID, key rejected, .xlsx, Google busy) |
  | schedule-tab (4) | Found the tab "{title}". | No tab named "{name}". Your tabs: {list}. → Rename the tab that holds the month rows, or set SCHEDULE_TAB to its name. |
  | header-row (4) | Headers are in row {n}. | No row with "Month" in the first 25 rows. → Put the headers (Month, then Tenant, Count and Amount for each portion) in one row near the top. |
  | months (4) | {n} month rows, {first} to {last}, written as dates / text such as "Oct-26". | the parse message (names the row) |
  | row-below (4) | Row {n}, under the last month, is free for the next month. | warn: Row {n}, right under the last month, is not empty, so RentBook can't add the next month there. → Move what is in row {n} lower down, or clear it. |
  | total (4) | Column "{h}" adds itself up with a formula. / Column "{h}" holds typed totals; RentBook keeps them up to date. / No total column. | Not found → Set TOTAL_HEADER to the header exactly as in the header row, or delete it. warn (unset, a "Total…" header holds typed numbers) → Set TOTAL_HEADER to "{h}" so RentBook keeps it up to date. |
  | settings (5) | {on} portions ({off} switched off), each with its Tenant, Count and Amount columns. | todo (fresh Sheet): Not created yet. Prepare my Sheet creates it with {n} portions found in your header. fail: the existing "Settings tab is missing" text; a parse or column message → Make the header names in the Settings tab match the Schedule header row. |
  | log (5) | Headers are right. {n} entries. | todo: Not created yet. warn: Column H is headed "{x}", where RentBook writes who logged each payment. → Move that column to the right of column I. |
  | tenants (5) | Headers are right. {n} rows. | todo: Not created yet. fail: the header message + " Logging rent still works." |
  | portion-settings (6) | Check each portion's payments per cycle and hike before the first payment. | todo while Settings does not exist |

- When the connection fails, every later check is `skip` with "Waiting for the checks above."
- Tests (FakeGateway, plus a stub that throws `configError`):
  - a healthy fixture gives all ok with the right facts;
  - each problem row above;
  - a fresh Sheet (Schedule only) gives three todo checks and the preview;
  - `fake.calls` holds only `listTabs`, `getManyValues` and `getValues`;
  - a canary tenant name, phone and amount never appear in `JSON.stringify(result)`.

### 3-6 The /setup page and "Prepare my Sheet" (item 17)

Read: `route.md`, `connection.md`, `redirect.md`, `maxDuration.md`, `use-router.md`.
Files: new `src/app/setup/page.tsx`, `src/components/CheckList.tsx`, `src/components/PrepareSheet.tsx`, `src/lib/sheets/prepare.ts`, `src/app/api/setup/prepare/route.ts`, `src/lib/layout-rules.ts`, tests (`tests/server/setup-page.test.ts`, `tests/sheets/prepare.test.ts`, `routes.test.ts`; deliberate list additions in `guards.test.ts` and `max-duration.test.ts`).

- Who sees what:
  - A stranger is sent to `/signin`.
  - A member gets `PageHeader` "Set up" and a Notice: "Set up is for the owner. If something isn't working, ask the owner to open it." No check runs.
  - The owner gets `envChecks`, then `getSheetsContext()` in try/catch (a config error makes steps 3–6 `skip`: "Fix the settings above first."), then `checkSheet(ctx.gateway, …)`.
- Layout:
  - `PageHeader` "Set up" with a `BackLink` to More.
  - Intro: "This page checks each part of the connection between {BRAND.name} and your Google Sheet. It only reads: nothing in your Sheet changes unless you tap Prepare my Sheet."
  - A headline Notice: success when all is OK, warn otherwise.
  - One `Card` per step: an `h2` with the step's Pill, then each check with its title, Pill, muted detail, and "To fix: {fix}".
- Prepare card. It shows only when step 5 has todo checks and steps 2–4 have no fail.
  - Copy: "Adds the missing tabs ({list}) with their headers. Nothing already in your Sheet is changed." When Settings will be created, add: "Settings starts with {n} portions from your Schedule header, each with 11 payments per cycle and a 5% hike. Check them in Portion settings before the first payment."
  - Button "Prepare my Sheet" (pending "Preparing…"). It sends `{}` to `/api/setup/prepare` with `sendJson`.
  - Success: toast "Your Sheet is ready: created {list}." (or "Nothing needed creating.") and `router.refresh()`. A failure shows `apiErrorMessage` in a `LiveNotice`.
- `prepareSheet(ctx)` runs `withWriteLock`: list the tabs, `resetBootstrap`, `ensureTabs` (whose rules already never reseed Settings over existing tabs and never overwrite data), list the tabs again, `invalidateCaches` in `finally`. It returns `{ created }`. The route: `readJsonBody` → `requireOwner` → `runWrite`.
- Step 6 card: a link to Portion settings, with "Set each portion's payments per cycle (or Count never resets) and hike before the first payment: the app cannot change a payment count later."
- A `<details>` "What your Sheet needs" lists `LAYOUT_RULES`, the plain-English rules that remain (right column of the audit).
- Tests:
  - stranger, member and owner renders;
  - the Prepare card only in the fresh case;
  - the HTML contains none of the dummy secrets or canaries;
  - `prepareSheet` on a fresh fake creates and seeds the three tabs; with Settings missing but Tenants present it refuses with the existing message and writes nothing;
  - route tests (owner only, member 403, cross-origin 403, write marked);
  - `smallTargets` is empty.

### 3-7 /diagnostics and the way there (item 17)

Files: new `src/app/diagnostics/page.tsx`, `src/lib/diagnostics-view.ts`, `app-nav.ts`, `src/app/more/page.tsx`, `BackLink.tsx` targets, `LoadProblem.tsx`, the pages that render `LoadProblem`, tests.

- Who sees what is the same as `/setup` (member Notice: "Diagnostics are for the owner."). The page exports `maxDuration = 15`.
- `diagnosticsRows(input)` (pure) produces:
  - App: "Version {version}" (package.json, as `/api/health`), "This server started {time}", "Settings: {ok} of {n} OK" with a link "Open Set up".
  - Google Sheet: Pill "Reachable" or "Not reachable"; "Answered in {listMs} ms (tab list) and {readMs} ms (data)." or the connection detail.
  - Tabs:
    - "Schedule: {n} month rows, {first} to {last}";
    - "Settings: {on} portions on, {off} switched off";
    - "Payments Log: {n} entries, last saved {time}";
    - "Tenants: {n} rows, {open} current";
    - "Not created yet" for a missing tab.
  - Problems: "Since {time} on this server: {e} errors, {w} warnings ({code} {n}, …)" or "No problems logged since {time}.", with a muted note: "Each server instance counts on its own and starts from zero when it restarts."
  - A "Check again" `ButtonLink` to `/diagnostics`.
- Navigation:
  - `tabForPath`: `/setup` and `/diagnostics` belong to the More tab (deliberate additions to the app-nav tests), and `BackLink` leads back to More.
  - More (owner only) adds the rows "Set up" ("Check each part of the connection to your Sheet") and "Diagnostics" ("How the app and your Sheet are doing"). The Portion settings hint becomes "Cycles, hikes, and adding or switching off portions".
- `LoadProblem` gets an optional `setupHref`. Pages pass it only for the owner and only on a config or sheet-structure error: "Open Set up to see what is wrong".
- Tests:
  - `diagnosticsRows` copy;
  - stranger, member and owner renders, with no canary;
  - the More rows show for the owner and not for a member;
  - the `LoadProblem` link shows only for the owner;
  - guards, max-duration, and proxy "runs on" lists gain `/setup` and `/diagnostics` (deliberate).

### 3-8 Vacancy rule and the month view (item 20)

Files: new `src/lib/domain/vacancy.ts`, `types.ts`, `month-view.ts`, new `src/lib/month-summary.ts`, tests (new `tests/domain/vacancy.test.ts`, `month-view.test.ts`, `month-summary.test.ts`).

- `occupancyFor(rows, tenancies, portionId, month)` returns `occupied`, `never`, or `vacant { since, previousTenant }`:
  1. The portion has an entry for the month → occupied.
  2. No entry in any earlier month → never (today's `needs-tenant`).
  3. A current tenancy (no move-out) for the portion → occupied.
  4. Find the latest earlier entry (month L, tenant T), then the portion's most recent past tenancy with `sameTenantName(T)` and a real move-out day D. If there is none → occupied.
  5. L is after the month of D (rent was logged after the move-out) → occupied.
  6. D is on or before the 1st of the month → vacant since D. Otherwise → occupied (the tenant lived there after the 1st, so the month is due).
- `firstVacantMonth(D)`: D's month when D is the 1st, else the month after. `vacancyOf(rows, tenancies, portionId)` gives the latest vacancy for the tenant page.
- Types:
  - `CardStatus` adds `"vacant"`.
  - `PortionCard` gains optional `vacancy?: { since; previousTenant } | null`. It is always set by `deriveMonthView`; optional so test factories still compile.
  - A vacant card has `next`, `rentReference`, `rentDifference`, `tenancy` and `undoBlockedReason` all null, so it adds nothing to `due`.
- `summaryCounts(view)`: `paid = view.paidCount`; `vacant` counts cards that are vacant or needs-tenant; `let = cards − vacant`.
- `summaryText`: "{paid} of {let} portions" plus " · {vacant} vacant", or "All portions are vacant". The "so far" rule becomes `paid < let`.
- Tests:
  - Asha moves out 2026-10-20 with October paid: October paid, November and December vacant since 2026-10-20.
  - Moving out on 2026-11-01: November vacant. On 2026-11-02: November due, December vacant.
  - Rent logged after the move-out → occupied.
  - A new tenant with the leaver's name → occupied.
  - An open tenancy → occupied.
  - A move-out of "soon" (not a date) → ignored.
  - Pin: the fixture with tenancies that have no move-out gives the hard-coded statuses, next counts, due and received for Aug 2026 to Jan 2027. Capture them before editing `month-view.ts`.

### 3-9 Vacant cards; no plain log on a vacant month (item 20)

Files: `PortionBoard.tsx`, `PaymentSheet.tsx`, `src/app/page.tsx`, `service.ts`, tests (`ui-smoke`, `home-page`, `service`).

- Cards:
  - Vacant and needs-tenant cards use Pill "Vacant", neutral (deliberate: "No tenant" becomes "Vacant"; the "No tenant recorded yet." line stays).
  - A vacant card reads "Vacant since {d Mon yyyy}. {previousTenant} moved out." and has a "Past tenants" link to `/tenants/{id}` that keeps the month (`aria-label="Past tenants of {name}"`, `min-h-11`), plus "Add tenant", which opens the New tenant sheet for that portion.
  - New tenant options read "{name} (vacant)" for vacant portions.
- The home summary uses `summaryText`. Deliberate: `home-page.test.ts` stays green because the factories' cards are pending.
- `logPayment`: when there is no `newTenantName`, no entry for the month, and the portion is vacant, it refuses with `conflict("{portion} is vacant in {Month YYYY}: {tenant} moved out on {d Mon yyyy}. Refresh the page, then add the new tenant with New tenant.")`. New tenant on a vacant portion works as today.
- Tests: the card renders, the option label, the summary with 1 vacant, the refusal, and a vacant month followed by New tenant (count 1; the next month is pending for the new tenant). `smallTargets` is empty.

### 3-10 Moving out leaves the portion vacant cleanly (item 20)

Files: `tenancy-service.ts`, `schemas.ts`, `api/tenancies/move-out/route.ts`, `tenancy-input.ts`, `MoveOutForm.tsx`, `tenants/[portionId]/page.tsx`, `tenancy-view.ts`, `toast-copy.ts`, tests.

- Copy:
  - Tenant page: "Your Schedule is not changed." becomes "{portion} shows as Vacant from the first month that starts on or after the move-out date, until you add a new tenant. Payments already in your Schedule stay."
  - Move-out toast: "{tenant} has moved out. {portion} is vacant from {Month YYYY}." (`firstVacantMonth`).
- Move out without details. When the Schedule names a tenant, the portion has no open tenancy, and that tenant has not already moved out, the page shows the Move out section anyway: "Record that {tenant} has moved out. You don't need to add their details first." The form has only the date and notes.
  - `moveOutBody` also accepts `{ portionId, tenant, moveOut, notes? }` with no id.
  - `moveOutWithoutDetails` (write lock, fresh snapshot, usable Tenants tab) refuses with a conflict when the Schedule's tenant is no longer `tenant` or an open tenancy exists. Otherwise it appends a closed row: a new id, the portion, the tenant, a blank move-in, the move-out, notes, and updated by/at.
- Both move-outs refuse a date before the first day of the month of the tenant's latest Schedule entry: "{tenant} has rent logged for {Month YYYY}. Choose a move-out date in {Month YYYY} or later, or undo that payment first." (field `moveOut`). This is deliberate.
- `PortionTenants` gains `vacantSince`. The page shows "Vacant since {date}. Add the next tenant with New tenant on the month screen." above Current tenancy; the existing "moved out" note and the Add details form stay.
- Tests: the service (append shape, refusals, the vacancy that follows), the route (both bodies, member allowed, conflict marks the write), the page in each state, the past tenancy showing "— to 20 Oct 2026", and the toast copy.

### 3-11 Switched-off portions: the Active column, read side (item 21)

Files: `settings-store.ts`, `types.ts`, `schedule.ts`, `service.ts`, `month-view.ts`, `PortionBoard.tsx`, `PaymentSheet.tsx`, `tenancy-service.ts`, tenants page, `sheet-checks.ts`, tests.

- Settings:
  - `SETTINGS_HEADERS` gains "Active" and `SETTINGS_RANGE` becomes `A1:H50` (deliberate: `snapshot-read.test.ts` pins `A1:G50`).
  - Column H is read only when H1's `headerKey` is "active". A portion is off when its H cell reads "no", "inactive" or "off", or is `false`. Then `PortionConfig.inactive = true` (optional field, absent = on).
  - Seeding writes the eight headers with H left blank.
- `parseSchedule` skips a switched-off portion whose three headers are all gone (no columns, no entries); a portion with some headers missing is still an error. `ensureMonthRow` and the typed total use only portions that have columns.
- Month view:
  - A switched-off portion gets a card only in a month where it has an entry, with `inactive: true` and a muted line "Switched off in Portion settings."
  - It never appears in New tenant.
  - `logPayment` refuses a new entry for it: "{name} is switched off in Portion settings. Switch it back on to log rent for it." Edit and undo still work.
- Tenant page: works for a switched-off portion, with the Notice "This portion is switched off. Its history stays here."
- Tests:
  - pins: a blank H1 with "No" in H3 leaves every portion on; the fixture views are unchanged;
  - "No" under "Active" hides p4 in months without an entry and shows it with its entry;
  - deleted columns of an off portion are tolerated, and logging other portions and adding a month still work;
  - the refusal.

### 3-12 Planning portion changes (pure) and room for columns (item 21)

Files: `gateway.ts` (`ensureColumnCount(tab, columns)`), `google-gateway.ts` (sheet props fields `gridProperties(rowCount,columnCount)`, deliberate change to the fields string in `google-gateway.test.ts`; `appendDimension COLUMNS` only when narrower, never retried, props forgotten on failure), `tests/support/fake-gateway.ts` (optional `gridColumns` per tab: a write beyond it throws "exceeds grid limits" like Google, and `ensureColumnCount` widens it), new `src/lib/sheets/portion-plan.ts`, tests (`portion-plan.test.ts`, gateway tests).

Planners are pure. Their input is the Schedule `A1:ZZ` and Settings `A1:Z50` read with FORMULA, plus the parsed portions with their Settings rows. They return the exact `CellWrite[]`.

- `planAddPortion(input, { name, cycleLength, hikePercent })`:
  - Name: `cleanText`, 1–60 characters, unique among portions ignoring case. Cycle 1–120 or null; hike 0–100 (shared with `updateSettings`'s checks). At most 20 portions.
  - Id: `p{k}`, the smallest k unused in Settings column A.
  - Headers: `Tenant{n}`/`Count{n}`/`Amount{n}`, with a space before n when the last portion's Tenant header has one. n is the smallest number from 2 up whose three names appear neither in the header row (`headerKey`) nor in any Settings row.
  - Columns:
    - Adopt: if an exact, adjacent triple with that pattern is in the header row, unused by Settings, with every cell below blank, use it and plan no Schedule write. This also resumes a half-finished add.
    - Otherwise the three columns start just right of the right-most non-blank cell in any row. Past ZZ is refused: "Your Schedule has no room for three more columns (it is full up to column ZZ)."
  - Settings row: the first row after the last portion row whose A to Z cells are all blank, at row 50 at the latest, else refused: "The Settings tab has no free row up to row 50 for a new portion. Clear an unused row, then try again." Notes are skipped over, never written.
  - Returns `{ id, headers, columns, adopted, minColumns, scheduleWrites, settingsWrites }`.
- `planSetActive(input, id, active)`:
  - Writes H{row} "No" or "Yes", and H1 "Active" when H1 is blank.
  - Refused when H1 holds other text, or when a portion row's H cell is neither blank nor a flag: "Column H of the Settings tab holds "{x}". RentBook keeps the Active setting there. Move that column further right, then try again."
  - Switching on a portion that is already on writes nothing.
- `planReorder(input, ids)`:
  - `ids` must be exactly the current ids, else `conflict("Your portions changed since this page loaded. Refresh and try again.")`.
  - Each portion-row slot (rows sorted) gets the A:G cells (A:H when H1 is "Active") read from the portion now placed there, with values as read. Only changed rows are written.
  - A formula in those cells is refused: "Settings row {r} has a formula in it, which RentBook cannot move. Replace it with its value, then try again."
  - Schedule columns never move.
- Tests apply each plan to a FakeGateway copy of the fixture, then call `loadSnapshot`:
  - the new portion is last with no entries, and every old portion and month reads as before;
  - a grid diff equals the planned cells exactly;
  - the cases above, including adopting hand-added columns, the "Tenant 2" style, something in column AB of row 9 pushing the columns right, a note row skipped, no writes for an unchanged order, and the refusals with their text.

### 3-13 Portion services (item 21)

Files: new `src/lib/sheets/portion-service.ts`, test `tests/sheets/portion-service.test.ts` (a FakeGateway subclass in the test plays "someone else" between steps).

Each service runs `withWriteLock`, then `loadSnapshot` (a broken layout refuses with its own message plus " Set up shows what is wrong."), then one `getManyValues` FORMULA read, the plan, and the writes; `invalidateCaches` runs in `finally`.

- `addPortion` writes in an order whose failure is always harmless:
  1. `ensureColumnCount` when needed.
  2. Schedule header cells: one `updateValues`, then read back ("The new Schedule columns may not have been saved. Check row {n} of your Schedule, then try again.").
  3. Re-read Settings A1:Z50, and refuse when the planned row is no longer blank ("Someone changed the Settings tab a moment ago. Refresh and try again.").
  4. The Settings row: `updateValues`, then read back.

  Headers without a Settings row are ignored by the app and adopted on the next try; a Settings row without headers would break every page, so it always comes last. It returns `{ portion, columns: [{ header, letter }], totalNote }`. When the total cell is a formula, `totalNote` reads: "Your {total} column adds up the amounts with a formula. Add column {letter} ({Amount6}) to it in your Sheet so the total includes {name}."
- `setPortionActive({ id, active, today })`:
  - Switching off is refused unless the portion is vacant or has never had a tenant in the month after today's month (`occupancyFor`) and has no open tenancy: "{name} still has a tenant ({tenant}). Record the move-out on the tenant page first." It is also refused when no other portion would stay on: "Keep at least one portion switched on."
  - Write H, then read back.
- `reorderPortions({ ids })`: one `updateValues`, then read back every written row; a mismatch says "The new order may not have been saved fully. Open the Settings tab and check the order (File > Version history can restore it)."
- Tests:
  - happy paths read back through `getMonthView` and `getSettings`;
  - the call order in `fake.calls`;
  - a failed Settings write leaves only the three headers, the app still loads, and the retry adopts them;
  - two adds started 1 ms apart (`delayMs`) give p6 and p7 on different columns and rows;
  - someone typing into the planned row gives a conflict and Settings is untouched;
  - read-back mismatches;
  - every refusal writes nothing;
  - caches are invalidated after success and after failure.

### 3-14 Portion routes and client builders (item 21)

Files: new `src/app/api/portions/route.ts` (POST add), `api/portions/active/route.ts` (PUT), `api/portions/order/route.ts` (PUT), `schemas.ts` (`addPortionBody`, `portionActiveBody`, `portionOrderBody`: ids distinct, 1–20 items of 1–20 characters), new `src/lib/portion-requests.ts` (`buildAddPortionRequest` with field errors in the 2-10 style; `moveInOrder(ids, index, delta)`), `form-errors.ts` (name/cycle/hike), `toast-copy.ts` ("{name} added", "{name} switched off", "{name} switched on", "Order saved"), tests (`routes.test.ts`, `schemas.test.ts`, domain tests, guards and max-duration lists, deliberate).

- Routes: owner only (`requireOwner`), `runWrite`, `maxDuration = 15`; the add returns the service result; the others return `{ portions }`.
- Tests: stranger 401, member 403, cross-origin 403, bad body 400 with `details.field`, success marks the write, a conflict marks the write.

### 3-15 Portion settings screen (item 21)

Files: `src/app/settings/page.tsx`, `SettingsForm.tsx`, new `src/components/AddPortionSheet.tsx`, `SwitchOffSheet.tsx`, `PortionOrder.tsx`, tests (render and source tests, `smallTargets`).

- `SettingsForm` edits switched-on portions only. Each fieldset gets a "Switch off" `dangerText` button (`aria-label="Switch off {name}"`). Below the form: "Add a portion" and, with two or more portions, "Change order" (secondary).
- `AddPortionSheet` ("Add a portion"):
  - Fields: Portion name; Payments per cycle (11) with Count never resets; Hike at each new cycle (%) (5).
  - Muted text: "RentBook adds three columns for this portion (Tenant, Count and Amount) to the right of your Schedule, and a row to the Settings tab. Nothing else in your Sheet changes."
  - Submit "Add portion" (pending "Adding…").
  - On success the sheet shows a success Notice, "{name} added. Its columns in your Schedule are {Tenant6} ({R}), {Count6} ({S}) and {Amount6} ({T}).", plus a warn Notice with `totalNote` when there is one, and "Done" (close and refresh).
- `SwitchOffSheet` ("Switch off {name}?"):
  - Text: "It leaves the month screen and the New tenant list. Its payments stay in your Schedule and Payments Log, its tenants stay on its tenant page, and you can switch it back on here."
  - Buttons: "Switch off" (danger, pending "Switching off…") and "Keep it on" (initial focus). A refusal shows in its `LiveNotice`.
- "Switched off" section: a Card per portion with the muted line "Hidden from the month screen. History kept." and "Switch on" (pending "Switching on…").
- `PortionOrder` replaces the form while open: an `ol` of all portions (off ones carry Pill "Off"), each with inline-svg Move up and Move down buttons (`aria-label="Move {name} up"`, 44 px, disabled at the ends). A `LiveNotice` says "{name} is now {n} of {total}." Buttons "Save order" (pending "Saving…") and "Cancel".
- Every write ends in a toast or an inline message; forms are disabled while saving.
- Tests: the renders, labels and aria, the source uses `sendJson` and the toast copy, `smallTargets` is empty, and `design-system.test.ts` still passes.

### 3-16 Docs

Files: `SETUP.md`, `README.md`, `docs/product/THREAT-MODEL.md` (one line), new `tests/server/layout-rules-doc.test.ts`.

- SETUP.md:
  - Env table: `TOTAL_HEADER` is optional (when to set it); `SETTINGS_TAB`/`LOG_TAB`/`TENANTS_TAB`; the "rename your own Tenants tab" advice gains "or set TENANTS_TAB".
  - New section "Check your setup in the app" (More, Set up, the six steps, Prepare my Sheet, Diagnostics).
  - "Your Sheet's layout": every `LAYOUT_RULES` line. The test checks each line appears.
  - "Adding, switching off and reordering portions", and what is not supported: deleting a portion or its history, renaming or moving its Schedule columns, changing its id, editing a Total formula. The safe by-hand order to remove one completely: switch it off; delete its three columns only if its history is not wanted (keep a copy); then delete its Settings row.
  - "Moving out and vacant portions" replaces every "Your Schedule is not changed" statement.
- README feature bullets: vacant portions, adding/switching off/reordering portions, Set up and Diagnostics.
- THREAT-MODEL: "/setup and /diagnostics are owner-only and show no secret, key, token or tenant data."

### 3-17 Verify

1. Gates: `npm test`, `npm run typecheck`, `npm run lint`, `env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npm run build`. Working tree clean. Note the test count before and after.
2. `next start` smoke from a scratch copy, as in wave 2's 2-13 (symlink `node_modules`; `getSheetsContext` returns a FakeGateway seeded from the fixtures; dummy env with a canary in `AUTH_SECRET`, `AUTH_GOOGLE_SECRET` and the key's `private_key`; session cookie minted with `@auth/core/jwt`). Seed:
   - p1 paid;
   - p2 moved out on the 1st of this month (vacant);
   - p4 never let;
   - one switched-off portion with an entry two months ago.

   Then check:
   - `/api/health` is exactly `{ ok, version }`;
   - the HTML of `/setup` and `/diagnostics` (owner and member) contains no canary;
   - a fresh-Sheet run shows Prepare my Sheet and, after tapping it, three new tabs;
   - Add portion creates the columns and the row in the fake grids, and the month screen shows the new card.
3. Playwright (Chromium, 390 × 844, light and dark), screenshots in the scratch dir: `/setup` (all OK; fresh Sheet; member), `/diagnostics`, the month screen with a vacant card and the summary, the tenant page after a move-out and the no-details Move out form, `/settings` with the Add sheet, its success state, the Switch off sheet, the order editor and the Switched off section. No CSP violations in the console. Walk: More → Set up → back to More; month → vacant card → Add tenant.
4. Report: test count, every deviation, every deliberate test change, and what could not be verified: real Google `appendDimension COLUMNS` and `values.batchUpdate` atomicity, races between two server instances, real latency figures, case-insensitive tab titles on a real Sheet, and the owner's real Settings column H content (confirm H1 is blank before deploying).
