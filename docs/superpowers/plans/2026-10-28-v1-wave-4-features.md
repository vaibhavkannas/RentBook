# RentBook v1 wave 4: features (roadmap items 25 to 28)

> For agentic workers: implement task by task, test-first, with the gates below. One commit per task.

**Branch:** `v1-wave-4`, stacked on `v1-wave-3`. **Roadmap:** `docs/product/ROADMAP-v1.md`, wave 4, the owner-selected items only: 25 overdue (arrears) list, 26 year view with totals per portion, 27 agreement-end and hike-due alerts, 28 Tenancy Log (tenant-detail change history). **Tech:** Next.js 16.3.8, React 19, TypeScript strict, Tailwind 4, Vitest, zod, `@googleapis/sheets`.

**Goal:** the owner sees at a glance who owes rent and since when, how each portion did across a year, which agreements are ending and whose rent goes up next, and what was changed in a tenant's details, by whom and when. Every figure comes from the Sheet data the app already reads (one snapshot); the only new writes are append-only rows in a new "Tenancy Log" tab.

**Out of scope:** CSV export, printable receipts, WhatsApp share, notifications, emails or push, the Config tab (the time zone stays Asia/Kolkata through `todayIso`/`currentYm`), demo mode, vacancy alerts, back-filling history from before this wave, recording edits made straight in the Sheet, wave 5.

**Builds on waves 2 and 3.** When this plan was written wave 2 had landed up to 2-4 and wave 3 was a plan (`plan-wave-3.md`). Use what landed, under its real names, and say in the commit body where a name differs. Reuse: `Page`, `PageHeader`, `BackLink`, `Card`, `Pill`, `Notice`/`LiveNotice`, `EmptyState`, `Skeleton`, `ButtonLink`, `useToast` and `toast-copy.ts`, `sendJson`, `app-nav.ts` (`monthParam`, `withMonth`, `tabForPath`), the More page, `activity-view.ts` (the "by you" rule), `smallTargets`, `design-system.test.ts` (wave 2); card status `"vacant"`, `occupancyFor` (3-8), `PortionConfig.inactive` (3-11), `moveOutWithoutDetails` (3-10), `headerKey` (3-1), named tabs (3-3), `checkSheet`/`diagnosticsRows` (3-5, 3-7), `LoadProblem`'s `setupHref` (wave 3). Invent no new primitive; if one is truly missing, add it under `src/components/ui/` with a test.

## Global constraints

- This is not the Next.js you know (`AGENTS.md`). Before using a Next API read its doc under `node_modules/next/dist/docs/` (tasks name the ones they need). `src/proxy.ts` is the old middleware.
- Writes to Google stay RAW. No real email address anywhere in the repo (example.com only). Never read or print secrets. Never run `npm run verify:testcopy`. No push to main, no deploy.
- NO new dependencies (the only addition so far was `server-only`). No external fonts or icon packages, no CSS framework beyond the installed Tailwind 4, no test library beyond Vitest. UI tests use `react-dom/server` renders and source reading (see `tests/server/ui-smoke.test.ts`, `tests/server/client-requests.test.ts`); browser checks may use the global Playwright (`/opt/node22/bin/playwright`, browsers in `/opt/pw-browsers`, Chromium) from a scratch dir, never added to `package.json`.
- Every task is test-first (TDD) and ends with `npm test`, `npm run typecheck`, `npm run lint` and `env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npm run build` green (the build must pass with no auth environment; retry with `NODE_OPTIONS=--use-system-ca` on a certificate error). One commit per task; the message ends with a blank line and:
  `Claude-Session: https://claude.ai/code/session_01NEJMNwocTNcPN7LxPkW8Yx`
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Existing tests stay green. An old test changes only where a task below says the behaviour changes on purpose; say why in the commit body.
- The owner's live behaviour and data must not change except where a task says so. Keep the current Sheet layout working, the current auth, every page dynamic (`getViewer()` calls `connection()`), and the nonce CSP in `src/proxy.ts` (no inline scripts, no `<style>` blocks; inline `style` attributes and inline `<svg>` are allowed).
- Plain English, phone first (360 to 430 px, thumb reach, 44 px targets), light and dark, accessible (labels, visible focus, contrast, `aria-live` for status, never colour alone). Pure logic in `src/lib` with unit tests; components stay thin.
- Wave rules:
  - Every new page that reads the Sheet exports `maxDuration = 15`, reads through the snapshot cache (`loadPageSnapshot`, 4-5) and adds no Google read to the month screen.
  - Every new route runs `readJsonBody` before `requireUser`, inside `handle()`, and writes through `runWrite`.
  - Log lines never carry a tenant name, a phone number, a note or a tenancy value (`logEvent` fields only; messages say counts and places).

Suggested sittings (one implementer each): 4-1 to 4-4 (pure logic), 4-5 to 4-7 (screens), 4-8 to 4-10 (Tenancy Log writes), 4-11 to 4-13 (History, setup and docs, verify).

## Definitions (what the code computes and the screens say)

Today is `todayIso(now)` and this month `currentYm(now)`, as every page does now. All rules read one snapshot (`rows`, `portions`, `tenancies`).

**Overdue (item 25)**, in `src/lib/domain/rent-due.ts` and `overdue.ts`:
1. Rent for a month falls due on day `RENT_DUE_DAY = 1` of that month and counts as overdue `OVERDUE_GRACE_DAYS = 5` days later (from the 6th). `lastDueMonth(today)` is this month from that day on, else last month.
2. Per portion only the tenant of its latest Schedule entry is looked at (any month, months paid ahead included), from the first month of their latest unbroken run of entries. An entry by another tenant ends the run, so an earlier tenant's gaps are history, not arrears.
3. Each month from that start to `lastDueMonth` is judged by the portion's card from `deriveMonthView` for that month, so every figure is what the month screen shows:
   - `pending`: unpaid; owed is the card's `rentReference` (the suggested rent, hiked on a new cycle);
   - `paid` with `rentDifference < -SHORTFALL_TOLERANCE` (`0`): short; owed is `-rentDifference` (the card's "less than rent"). A hiked month within the ₹ 10 rounding allowance is paid in full, and a new tenant's first payment is never short, exactly as on the card;
   - `vacant` or `needs-tenant` (wave 3), or no card (switched off): skipped.
4. A month paid ahead is never overdue and does not make up an earlier month. An extra amount in one month is not moved to another. The deposit ("Advance" on the tenant page) is not rent.
5. Days overdue run from the month's due date to today. Order: most owed first; equal amounts, oldest month first; then Settings order.

**Year view (item 26):** per portion and month, from the same cards: `paid`; `partial` (short as in rule 3); `unpaid` (pending, month on or before `lastDueMonth`); `upcoming` (pending, later); `vacant` (vacant, or needs-tenant on or after the Schedule's first month); `none` (before the Schedule's first month, or no card). Received is the sum of amounts entered. Due is the sum of the reference rent (or the amount when a paid card has none) over paid, partial and unpaid months. Upcoming, vacant and none add nothing.

**Alerts (item 27)**, in `src/lib/domain/alerts.ts`:
- Agreement: the portion's current tenancy (no move-out) whose tenant is the Schedule's latest tenant (the tenant page's `current` rule), with a real Agreement end. `days = daysBetween(today, end)`: below 0 ended, 0 today, 1 to `AGREEMENT_NOTICE_DAYS` (60) soon, more: no alert. An ended alert stays until the date is changed or the tenant moves out.
- Hike: the Sheet has no hike date; the hike comes with the first payment of a new cycle. From the latest entry (month L, count c): `paymentsLeft = startsNewCycle(c, cycle) ? 0 : cycle - c`, `hikeMonth = L + paymentsLeft + 1` (one payment a month). Alert when `hikeMonth <= this month + HIKE_NOTICE_MONTHS` (2): `due` when `hikeMonth <= this month`, else `soon`. No alert when the count never resets, the hike is 0 %, or the portion is vacant this month or switched off. New rent = `suggestAmount(latest amount, hike, true)`.

**Tenancy Log (item 28):** a new app tab "Tenancy Log", columns A to H: `Saved at`, `Tenancy ID`, `Portion` (the id, as in the Tenants tab), `Action` (`Added`, `Edited`, `Moved out`, `Closed`), `Field` (the Tenants header of the column that changed), `Old value`, `New value`, `Changed by`. Append-only, RAW, one row per changed field, every row of one save in ONE append. `Phone` and `Notes` rows say only that they changed (both values blank). No tenant name is copied: the History finds it by Tenancy ID.

## What must not change for the owner, and the test that pins it

| Behaviour | Pinned by |
| --- | --- |
| Month cards, totals, hike rounding | `month-view`, `rent-rules`, `rent-difference` tests untouched; 4-2 "every owed amount equals the card" |
| One Google read per snapshot | `snapshot-read.test.ts` untouched (the Tenancy Log is never part of the snapshot) |
| Payments Log appends and retries | `log-resilience.test.ts`, `log-retry.test.ts` untouched after the 4-9 refactor |
| Payments retry tokens | 4-10: a token made from fixed inputs equals the string captured before the refactor |
| Tenancy writes touch the same Tenants cells | `tenancy-service`, `tenants-store` tests untouched; 4-9: Tenants grid identical when the Tenancy Log append fails |
| Bootstrap leaves existing tabs alone | 4-8: a Sheet with today's four tabs only gains "Tenancy Log" with its header; every other grid deep-equals the copy taken before |
| Card chips | `tenancy-chips.test.ts` untouched (the new `today` argument is optional) |
| Month screen for any month but this one | `home-page.test.ts` green; the new card renders only for this month |

Deliberate test changes (say why in the commit body): the `tab-bootstrap.test.ts` and `settings-store.test.ts` fixtures that stand for "every app tab exists" gain the Tenancy Log (they assert no `addTab` or the exact tab list); the `max-duration`, `guards`, `proxy` ("runs on") and `app-nav` lists gain the new pages and route; `home-page.test.ts` and `tenants-page.test.ts` mock the new loaders; wave 3's fresh-Sheet setup test expects four todo tabs.

## Decisions the owner may want to override

1. **Overdue rule:** due on the 1st, overdue from the 6th; the amounts are the month cards' own; only the latest tenant's run counts (a tenant who left owing drops off once the next tenant's first payment is logged); extras do not offset other months; most owed first. The constants sit in `rent-due.ts`.
2. **A run of unpaid months** is owed at each card's suggestion, which comes from the last payment, so a hike that falls inside the run is only added once a payment is logged (the cards already behave this way).
3. **Alerts:** agreements from 60 days before the end and after it; hikes from 2 months before the payment that carries them; none for 0 % or "count never resets".
4. **Tenancy Log:** Phone and Notes changes are recorded without old or new values; history starts at deploy; edits made in the Sheet are not recorded. The first page view after deploying adds an empty "Tenancy Log" tab to the owner's Sheet.
5. **No tab-bar badge:** the bar is drawn once in the root layout with no Sheet data, so a count would cost a Sheet read on every page. Counts show on a "Needs attention" card on the home screen, for this month only.
6. **History write failures** are retried once automatically from the browser with a signed token, then a toast says the entry is missing. There is no Retry button (the Payments Log keeps its own).
7. **Navigation:** the three new screens belong to the Month tab; their back arrow returns to the month that was showing. More lists them too.

---

### 4-1 Calendar days and the due-date rule (pure)

Files: `src/lib/domain/year-month.ts`, new `src/lib/domain/rent-due.ts`, tests `tests/domain/year-month.test.ts` (additions), new `tests/domain/rent-due.test.ts`.

- `year-month.ts`: `daysBetween(fromIso, toIso)` (whole days through `Date.UTC`, negative when `to` is earlier, throws on a value that is not a real day), `addDays(iso, n)`, `firstDayOf(ym)` (`YYYY-MM-01`).
- `rent-due.ts`, each constant with a plain-English comment: `RENT_DUE_DAY = 1`, `OVERDUE_GRACE_DAYS = 5`, `SHORTFALL_TOLERANCE = 0`.
  - `dueDate(month)`, `lastDueMonth(today)`, `daysOverdue(month, today)`.
  - `cardShortfall(card)`: for a paid card, `-rentDifference` when it is below `-SHORTFALL_TOLERANCE`, else 0; 0 for every other status.
  - `latestTenantStart(rows, portionId)` → `{ tenant, start } | null`: inside a month the lower row wins (`findEntryForMonth`), names compare with `sameTenantName`.
- Tests:
  - leap day 2028-02-29, month and year ends, negative spans;
  - India midnight: `todayIso(new Date("2026-10-16T18:30:00Z"))` is the 17th and `18:29:59Z` the 16th, fed into `lastDueMonth`;
  - 5 Oct → September, 6 Oct → October; `RENT_DUE_DAY` lies in 1 to 28;
  - `cardShortfall` on real `deriveMonthView` cards: a hike paid at 13 340 against 13 335 is 0, at 13 300 is 35;
  - the run start: a tenant change, the same name in another case, blank months inside one run, a month typed twice.

### 4-2 Overdue list (pure)

Files: new `src/lib/domain/overdue.ts`, new `src/lib/report-copy.ts` (overdue part), new `tests/domain/overdue.test.ts`, new `tests/domain/report-copy.test.ts`.

- Types: `OverdueMonth = { month, kind: "unpaid" | "short", expected, paid, owed, dueDate, daysOverdue }`; `OverdueItem = { portionId, name, tenant, months (oldest first), owed, oldest, daysOverdue, unpaid, short }`.
- `overdueList({ rows, portions, tenancies }, today)` applies the Definitions with ONE `deriveMonthView` per month for all portions, from the earliest run start to `lastDueMonth`. It keeps portions with at least one month and sorts by rule 5. `overdueTotals(items)` → `{ portions, owed }`.
- `report-copy.ts`:
  - `overdueAge(days)`: "1 day overdue", "{n} days overdue", from 60 days "about {round(n/30)} months overdue";
  - `overdueMonthLine(m)`: "Unpaid: {₹ owed}" or "Paid {₹ paid} of {₹ expected}: {₹ owed} short";
  - `overdueSummary(item)`: "{tenant} · {n} unpaid month(s)", plus " · {k} paid short" when there are any;
  - `OVERDUE_RULES`, built from the constants: "Rent for a month is due on the 1st and counts as overdue from the 6th." / "Amounts are what each month's card shows: the suggested rent for an unpaid month, or the part missing from a short one." / "Only the current tenant's months count. Vacant months and months paid ahead never do." / "A deposit is not rent and is never counted.";
  - `MOVED_OUT_HINT`: "Moved out? Record the move-out on the tenant page and the months after it stop counting."
- Tests, on `baseSchedule()` and fixtures written in the test:
  - today 2026-10-17: p2 ₹ 13,335 (new cycle, hiked), p3 ₹ 9,000, p1 ₹ 5,450, p5 ₹ 5,100, total ₹ 32,885; p4 (never let) absent;
  - today 2026-10-05: nothing (grace);
  - the pin: for every listed month, `owed` equals the card's `rentReference` (unpaid) or `-rentDifference` (short) from `deriveMonthView`;
  - September paid 5 000 against 5 450, October unpaid: September short ₹ 450, October ₹ 5,000 (the card's suggestion);
  - a hike paid at 13 340: not listed; at 13 300: ₹ 35 short;
  - November paid ahead, October unpaid: only October;
  - a tenant change: the earlier tenant's gap is not listed;
  - vacancy (wave 3): moved out on 1 October → not listed; on 2 October → October listed; a switched-off portion with no entries → absent;
  - a last entry in January 2025 with no move-out → 21 months, oldest February 2025;
  - ties: same amount, older first; same age, Settings order;
  - every copy text, singular and plural.

### 4-3 Year view (pure)

Files: new `src/lib/domain/year-view.ts`, `src/lib/report-copy.ts` (year part), new `tests/domain/year-view.test.ts`, `tests/domain/report-copy.test.ts`.

- Types: `YearCellState = "paid" | "partial" | "unpaid" | "upcoming" | "vacant" | "none"`; `YearCell = { month, state, received, due, shortBy }`; `YearRow = { portionId, name, cells (12), received, due }`; `YearView = { year, rows, received, due, firstMonth: YearMonth | null, hasData }`.
- `deriveYearView({ rows, portions, tenancies }, year, today)`: 12 `deriveMonthView` calls; rows in Settings order; a switched-off portion only when it has a card in some month of that year; `hasData` is false when every cell is `none`.
- `yearBounds(rows, today)` → `{ first, last }`: from the Schedule's first year (this year when there are no rows) to the later of its last year and this year. `parseYear(param)`: a whole year from 2000 to 2100, else null.
- Copy: `yearCellLabel(cell, portionName)` for the cell's `aria-label`:
  - "January 2026, {portion}: paid {₹}";
  - "…: part paid {₹ received} of {₹ due}";
  - "…: unpaid, {₹ due} due";
  - "…: vacant" / "…: not due yet" / "…: no record".
- Copy: `YEAR_LEGEND`: ✓ Paid, ½ Part paid, ! Unpaid, – Vacant, · Not due yet.
- Tests: `baseSchedule()` for 2026 with today 2026-10-17:
  - January to July `none`; August and September paid for p1 to p3;
  - p5: August `vacant`, September paid; p4: `vacant` from August to December;
  - October unpaid for p1, p2, p3 and p5; November and December upcoming;
  - received ₹ 59,400; due ₹ 92,285 (August 27,150 + September 32,250 + October 32,885).

  More cases:
  - 2025: `hasData` false, `firstMonth` August 2026;
  - a Schedule with no month rows: no data and bounds of this year only;
  - a short month is `partial` with `shortBy`;
  - December paid ahead counts in both received and due;
  - today 2027-01-10: January 2027 unpaid, the rest upcoming;
  - a Schedule starting in March: January and February `none`.

### 4-4 Alerts, the home card's words, an "ended" chip (pure)

Files: new `src/lib/domain/alerts.ts`, `src/lib/report-copy.ts` (alerts and home part), `src/lib/tenancy-chips.ts`, tests `tests/domain/alerts.test.ts`, `report-copy.test.ts`, `tenancy-chips.test.ts` (additions only).

- `alerts.ts`: `AGREEMENT_NOTICE_DAYS = 60`, `HIKE_NOTICE_MONTHS = 2`.
  - `hikeMonthFor(latestMonth, latestCount, cycleLength)`.
  - `agreementAlerts(snapshot, today)` → `{ portionId, name, tenant, agreementEnd, days, state: "ended" | "today" | "soon" }[]`: ended first (longest past first), then soonest.
  - `hikeAlerts(snapshot, today)` → `{ portionId, name, tenant, hikeMonth, paymentsLeft, currentRent, newRent, hikePercent, state: "due" | "soon" }[]`: earliest first, then Settings order.
- Copy:
  - "Agreement ended {n} day(s) ago, on {15 Mar 2027}." / "Agreement ends today." / "Agreement ends in {n} day(s), on {date}."; `AGREEMENT_HINT` "Renewed? Change the agreement end in Details.";
  - hike due: "Rent goes up {5}% with the next payment ({October 2026}): {₹ 12,700} to {₹ 13,335}.";
  - hike soon: "Rent goes up {5}% from the payment for {December 2026}, after {2} more payment(s): {₹} to {₹}.";
  - `attentionItems({ overdue, agreements, hikes, monthKey })` → `{ href, text, tone }[]`, empty when nothing is due:
    - "Rent overdue: {n} portion(s), {₹ owed}" (danger) → `/overdue?month=K`;
    - "{n} agreement(s) ended" (danger) and "{n} agreement(s) end within 60 days" (warn) → `/alerts?month=K`;
    - "Rent goes up soon for {n} portion(s)" (neutral) → `/alerts?month=K#hikes`.
- `tenancyChips(summary, today?)`: with a `today` after the end it says "Agreement ended {date}"; without `today` nothing changes.
- Tests: `baseSchedule()` with today 2026-10-17:
  - hikes: only p2, due, 12 700 → 13 335; a September count of 9 → December, soon; a count of 8 → none; never resets, 0 %, vacant (wave 3) or switched off → none;
  - agreements: an end of 2026-12-01 → soon, 45 days; 2026-12-16 (60) soon; 2026-12-17 (61) none; 2026-10-17 today; 2026-10-05 ended 12 days;
  - agreements with no alert: an open tenancy for another name than the Schedule's, a moved-out tenancy, "2027-02-30" and a blank end;
  - the India midnight boundary moves "today" to "ended";
  - every sentence, singular and plural.

### 4-5 One snapshot for the new screens; the Overdue screen

Read: `page.md`, `connection.md`, `redirect.md`, `loading.md`, `link.md`, `maxDuration.md`.
Files: `src/lib/sheets/service.ts` (`getSnapshot(ctx, { minFetchedAt })`; `getMonthView` and `getPortionTenants` use it, a refactor only), `src/lib/server/freshness.ts` (`loadPageSnapshot(ctx, email)`), `src/lib/app-nav.ts` (`tabForPath`: `/overdue`, `/year`, `/alerts` → month; `BackLink` target the month), new `src/app/overdue/page.tsx`, `src/app/overdue/loading.tsx`, tests (new `tests/server/overdue-page.test.ts`; `cache.test.ts`, `app-nav`, `guards`, `max-duration`, `proxy` lists, deliberate).

- Page: `getViewer` and redirect; `maxDuration = 15`; `monthParam` for the back link; `loadPageSnapshot` in try/catch → `LoadProblem` (with `setupHref` for the owner, as wave 3 does); `overdueList(snapshot, todayIso(now))`.
- Layout, top to bottom:
  - `PageHeader` "Overdue rent" with `BackLink` to the month ("Back to month").
  - A summary `Card`: "{₹ total} overdue" (`text-2xl font-semibold`), then muted "{n} portion(s) · counted up to {Month YYYY}".
  - One `Card` per item: the name (font-medium) with `Pill tone="danger"` {₹ owed}; `overdueSummary`; "Oldest: {Month YYYY}, {overdueAge}".
  - Under it an `ol` of months, each a 44 px link to that month (`monthHref`) with the month title and `overdueMonthLine`. Past 12 months: the 12 newest and "and {n} earlier months".
  - When the oldest month is more than 3 months back: `MOVED_OUT_HINT` with a "Tenant page" link (`/tenants/{id}?month=K`).
  - A `<details>` "How this is worked out" lists `OVERDUE_RULES`.
- Empty: `EmptyState` "Nothing overdue" / "Every let portion has paid in full up to {Month YYYY}.", with a ButtonLink "Back to the month".
- With `tenantsProblem` the list still shows, under a warn Notice: "The Tenants tab can't be read, so tenants who moved out may show here. {problem}".
- `loading.tsx`: the header, a summary bar and two card skeletons; `aria-busy`, sr-only "Loading overdue rent…", reduced-motion fallback.
- Tests:
  - service: `getMonthView` then `getSnapshot` cost one `getManyValues` on a cold cache (FakeGateway);
  - page: a stranger is redirected;
  - page (mock `loadPageSnapshot` with the parsed fixture): four items in order with their amounts, the month links, the empty state, the problem block, the Tenants warning, the rules;
  - `smallTargets` is empty.

### 4-6 Year screen

Files: new `src/app/year/page.tsx`, `src/app/year/loading.tsx`, `src/lib/ui-classes.ts` (`yearCellClasses(state)`), `src/app/page.tsx` (summary link), tests (new `tests/server/year-page.test.ts`, `ui-classes.test.ts`, `home-page.test.ts`).

- `/year?year=2026&month=2026-10`. The year comes from `parseYear`, else from the `month` param, else this year.
- Layout, top to bottom:
  - `PageHeader` "Year at a glance" with `BackLink` to the month.
  - A switcher row: "‹" ("Previous year"), the year as `h2`, "›" ("Next year"), each 44 px. Outside `yearBounds` an arrow is a muted `span aria-disabled="true"`.
  - A summary `Card`: "Received", then {₹} "of {₹ due}", and the progress bar (`progressPercent`, the month summary's markup).
  - The legend from `YEAR_LEGEND` (glyph and word, so state is never colour alone).
  - One `Card` per portion: the name, muted "{₹ received} of {₹ due}", and an `ol` `grid grid-cols-6 gap-1.5` of 12 cells.
    - Each cell is a link (`min-h-11 rounded-lg`, `yearCellClasses`) to `monthHref(key, currentKey)`, showing the short month name over the glyph, with `aria-label` from `yearCellLabel`.
    - A `none` cell is a muted `span` "—", not a link.
- `yearCellClasses`, tokens only:
  - paid `bg-success-bg text-success-ink`; partial `bg-warn-bg text-warn-ink`; unpaid `bg-danger-bg text-danger-ink`;
  - vacant `bg-line text-muted`; upcoming `border border-dashed border-line text-muted`; none `text-muted`.
- No data: `EmptyState` "Nothing recorded for {year}". The text is "Your Schedule starts in {Month YYYY}." (with a link to that year) or "Your Schedule has no months yet."
- Month screen (deliberate): under the summary's progress bar, a quiet "Year at a glance" link (`min-h-11`, muted underline) to `/year?year={y}&month={K}`.
- `loading.tsx` like 4-5.
- Tests:
  - the fixture year: five cards of 12 cells, a label for each state, links to `/?month=2026-08` and `/` for this month, "₹ 59,400 of ₹ 92,285";
  - an empty year; the disabled arrows at both bounds;
  - `yearCellClasses` per state; `smallTargets` is empty;
  - the home page link carries the viewed month and its year.

### 4-7 Agreements and hikes screen; the Needs attention card; the ways in

Files: new `src/app/alerts/page.tsx`, `src/app/alerts/loading.tsx`, new `src/components/AttentionCard.tsx`, `src/app/page.tsx`, `src/app/more/page.tsx`, `src/components/PortionBoard.tsx`, tests (new `tests/server/alerts-page.test.ts`, `home-page.test.ts`, the More page test, `ui-smoke.test.ts`).

- `/alerts?month=K`: `PageHeader` "Agreements and hikes" with `BackLink`.
  - `section id="agreements"`, `h2` "Agreements". A `Card` per alert:
    - the portion, with a Pill: ended (danger) "Ended", today (warn) "Ends today", soon (warn) "{n} days left";
    - the tenant (muted) and the sentence; the hint for an ended one;
    - a "Details" link (`/tenants/{id}?month=K`, 44 px, `aria-label="Details for {portion}"`).
  - `section id="hikes"`, `h2` "Rent hikes". A `Card` per alert: Pill due (warn) "Next payment" or soon (neutral) "{Month}", then the sentence.
  - Each section has its own empty line: "No agreement ends in the next 60 days." / "No rent hike in the next 2 months." (from the constants).
  - Muted footnote: "A hike comes with the first payment of a new cycle (see Portion settings). The app sends no reminders: check here."
- `AttentionCard` (server component, no hooks): `section aria-label="Needs attention"`, a `Card` listing `attentionItems`. Each row is a full-width 44 px link with an `aria-hidden` tone dot and "›". It renders nothing for an empty list.
- Home page:
  - When the viewed month is this month, it calls `loadPageSnapshot` (the same cache entry as `loadMonthView`, so no extra Google read) → `attentionItems` → `AttentionCard`.
  - The card goes between the month header and the summary.
  - It has its own try/catch: on a failure it shows nothing (the month view reports the problem).
- More page, for every viewer: a "Rent" group with three rows, each link carrying the month (`withMonth`):
  - "Overdue rent" ("Who owes what, most first");
  - "Year at a glance" ("Each portion, month by month");
  - "Agreements and hikes" ("Agreements ending and rent going up").
- `PortionBoard` passes `defaultDate` to `tenancyChips` as `today`.
- Tests:
  - the alerts page: one ended, one soon and one hike due; both empty texts;
  - the home page: the card with its three rows in order this month; no card for another month or when nothing is due (the existing tests mock `loadPageSnapshot` with a quiet snapshot, deliberate);
  - More rows for the owner and for a member;
  - a card with a past agreement end shows "Agreement ended 5 Oct 2026";
  - `smallTargets` on the alerts page, the card and More.

### 4-8 The Tenancy Log tab, its rows and a many-row append

Files: `src/lib/sheets/gateway.ts` (`appendRows(tab, rows)`), `google-gateway.ts`, `tests/support/fake-gateway.ts`, wave 3's `NamedTabsGateway` when it landed, new `src/lib/domain/tenancy-log.ts`, new `src/lib/sheets/tenancy-log-store.ts`, `settings-store.ts` (`ensureTabs`), tests (new `tests/domain/tenancy-log.test.ts`, `tests/sheets/tenancy-log-store.test.ts`; `tab-bootstrap`, `settings-store`, `fake-gateway`, `google-gateway` tests).

- Gateway: `appendRows` is ONE `values.append` with every row (RAW, `INSERT_ROWS`), never retried, like `appendRow`.
  - The fake records it as `"appendRows"`, so the existing `appendRow` counts stay true, and obeys `failOn` and `delayMs`.
  - The named-tabs wrapper maps its tab.
- `tenancy-log.ts` (pure):
  - `TENANCY_LOG_ACTIONS`; the `TenancyLogRow` tuple; `LOGGED_FIELDS` (the Tenants headers Phone, Move-in date, Agreement end, Advance, Advance date, Advance status, Refund, Deductions, Notes, Move-out date); `PRIVATE_FIELDS = ["Phone", "Notes"]`.
  - `TenancyChange` = `{ kind: "added", after }` | `{ kind: "edited", before, after }` | `{ kind: "moved-out", before: Tenancy | null, after }` | `{ kind: "closed", before, moveOut }`.
  - `tenancyLogRows(change, { now, changedBy })` → rows in Tenants column order:
    - values as the Tenants tab stores them (days as text, amounts as numbers, `""` for none); text is compared trimmed;
    - a row only for a field whose stored value changed; a private field leaves both values blank;
    - `added`: one row with a blank field; `closed`: one "Closed" row for Move-out date;
    - an edit that changed nothing gives `[]`.
- `tenancy-log-store.ts`: `TENANCY_LOG_TAB = "Tenancy Log"`, `TENANCY_LOG_HEADERS`, `TENANCY_LOG_RANGE = "A1:H"`.
  - `ensureTenancyLogTab(gateway, existingTabs)` works like `ensureTenantsTab`: creates the tab with headers, writes headers into an empty tab, and never touches a tab with content.
  - `parseTenancyLog(values)` → `{ items: TenancyLogItem[]; problem?: string }`:
    - headers are compared by position with `headerKey`; a wrong one gives "The Tenancy Log tab must have "{h}" in column {X} (found …). Put the headers back to see the history; saving changes still works." and no items;
    - blank rows are skipped; an unknown action is kept as `action: null`.
- `ensureTabs`:
  - creates the Tenancy Log after the Tenants tab;
  - the "Settings tab is missing" refusal also counts an existing Tenancy Log;
  - if 3-3 landed, a `TENANCY_LOG_TAB` env name (default "Tenancy Log") joins the named tabs and their "each a different tab" rule.
- Tests:
  - the diff for each kind: an edit of phone and agreement end gives two rows, Phone first, its values blank; a move-out with status, refund and deductions; closed; added; no change;
  - a canary phone and note never appear in any row;
  - `appendRows` in the fake and the Google gateway (one call, `requestBody.values` holds every row);
  - the bootstrap pin from the table;
  - Settings missing with only a Tenancy Log refuses with the existing message;
  - the header problem, blank and unknown rows.

### 4-9 Write the history after every tenancy change

Files: new `src/lib/sheets/append-log.ts`, `service.ts`, `tenancy-writes.ts`, `tenancy-service.ts`, `tenancy-log-store.ts`, tests (new `tests/sheets/tenancy-history-writes.test.ts`).

- `appendWithRetry({ append, attempts, retryDelayMs, maxWaitMs, budgetMs, event, what })` holds today's `appendLogRow` loop: it tries again only after `rate-limited`, stops at once on anything else, caps the wait and the budget, and logs each failed try through `errorLogFields`. `appendLogRow` calls it with today's values (3 tries, 1 s wait cap, 4 s budget, `payments-log-append-failed`).
- `appendTenancyHistory(gateway, rows, retryDelayMs)`:
  - `true` when there are no rows;
  - else `appendWithRetry` around `appendRows(TENANCY_LOG_TAB, rows)`, with `HISTORY_ATTEMPTS = 2` and `HISTORY_BUDGET_MS = 2_000` (the write already holds the lock inside a 15 s request);
  - event `tenancy-log-append-failed`, message "Tenancy Log: try {n} of 2 did not add {k} rows";
  - it never throws: anything thrown is logged and gives `false`.
- `recordNewTenant` returns `{ created: Tenancy | null; closed: { tenancy, moveOut }[] }`. Its two callers are updated; `createTenancy` still answers the created tenancy.
- After the main write succeeded, still inside the write lock and before `invalidateCaches`:
  - `createTenancy`: added and closed rows; `updateTenancy`: edited (`stored` vs `updated`); `moveOutTenancy`: moved out; wave 3's `moveOutWithoutDetails`: moved out with `before: null`;
  - `logPayment` with a new tenant: added and closed rows, only when `tenancyWritten`.
  - Results gain `historyWritten: boolean` and `historyRows` (server-only; 4-10 keeps them off the wire).
- Tests:
  - each path makes exactly one `appendRows` with the expected rows (Saved at = the stamp, Changed by = the viewer); an unchanged edit, a refused write and a failed tenancy write append nothing;
  - with `failOn appendRows`: the tenancy is saved, the Tenants grid deep-equals a run without history, `historyWritten` is false, one `tenancy-log-append-failed` line per try;
  - rate-limited then fine → true; a timeout → one try only;
  - with `captureLogs`, no line holds the canary tenant name, phone or note;
  - the Payments Log tests run unchanged.

### 4-10 History retry: a signed token, an idempotent route, one automatic retry

Read: `route.md`.
Files: `src/lib/server/retry-token.ts`, `src/lib/server/schemas.ts`, `tenancy-log-store.ts` (`retryTenancyHistory`), new `src/app/api/tenancies/history-retry/route.ts`, `src/app/api/tenancies/route.ts`, `move-out/route.ts`, `src/app/api/payments/route.ts`, new `src/lib/history-retry.ts`, `TenancyForm.tsx`, `MoveOutForm.tsx`, `PaymentSheet.tsx`, `src/lib/tenancy-response.ts` and `payment-request.ts` (types), tests.

- First the pin: `createRetryToken(ROW, VIEWER, NOW)` under the test secret equals the exact string it gives before this task (paste it into `retry-token.test.ts`).
- Tokens:
  - `createSignedToken(purpose, payload, viewer, now)` and `readSignedToken(token, purpose, schema, viewer, now)`;
  - `createRetryToken`/`readRetryToken` keep the purpose `log-retry:` and their messages;
  - new `createHistoryRetryToken(rows, viewer)`/`readHistoryRetryToken` with the purpose `tenancy-log-retry:`, 1 to 12 rows (`tenancyLogRowSchema`), body `{ token }` up to 4 000 characters.
- `withHistoryToken(result, viewer)` drops `historyRows`. It adds `historyRetryToken` only when `historyWritten === false` and there are rows. A result without those fields passes through unchanged, so the route tests' exact bodies stay.
- `retryTenancyHistory(ctx, rows)`, inside the write lock:
  - `ensureTabs`, then read the newest 30 Tenancy Log rows; a failed read is logged and returns false with nothing appended;
  - a stored row with the first row's Saved at, Tenancy ID, Action and Field → true;
  - else `appendTenancyHistory`; `invalidateCaches` in `finally`.
- `POST /api/tenancies/history-retry`, for every signed-in person, `maxDuration = 15`:
  - `readJsonBody` → `requireUser` → `parseBody` → `readHistoryRetryToken(token, viewer.email)`;
  - each row's Changed by becomes the viewer, then `runWrite` → `{ historyWritten }`.
- Routes: tenancies and move-out answer `withHistoryToken(result, viewer.email)`; payments applies `withRetryToken`, then `withHistoryToken`.
- `src/lib/history-retry.ts` (browser-safe):
  - `settleHistory(body, send = sendJson)`: `true` when `historyWritten !== false`; else one POST of the token (10 s timeout), true only for `{ ok: true, historyWritten: true }`;
  - `HISTORY_NOT_SAVED` = "The change was saved, but it couldn't be added to the History."
- Components: the save toast shows at once as now, then `void settleHistory(body).then((ok) => ok || toast.show(HISTORY_NOT_SAVED))`. This goes in TenancyForm, MoveOutForm (both modes) and PaymentSheet when a new tenant's details were written.
- Tests:
  - the token pin; tampered, expired and other-viewer tokens; each purpose refused by the other route;
  - a replayed retry appends once; a failed read appends nothing;
  - the route: stranger 401, cross-origin 403, bad body 400, member allowed, the write marked, `historyRows` in no answer body;
  - `settleHistory` with a stub `send`: no token, success, failure, no answer;
  - source tests that the three components call `settleHistory`; `client-requests.test.ts` stays green.

### 4-11 History on the tenant page

Files: new `src/lib/tenancy-history.ts`, `tenancy-log-store.ts` (`loadTenancyLog`, `readTenancyHistory`), `service.ts` (`SheetsContext.tenancyLogCache`, made in `withSnapshotCache`, cleared by `invalidateCaches`), `src/app/tenants/[portionId]/page.tsx` and `loading.tsx`, tests (new `tests/domain/tenancy-history.test.ts`, `tenancy-log-store.test.ts`, `tenants-page.test.ts`).

- `readTenancyHistory(ctx, portionId, { minFetchedAt })` → `{ items (this portion's, newest first), problem? }`. It reads through the cached `loadTenancyLog`: `ensureTabs`, then one `getValues` of `TENANCY_LOG_RANGE`. The snapshot stays one read; the tenant page adds one read, cached 15 s.
- `historyEntries(items, names, viewerEmail)` groups neighbouring rows with the same Saved at, Tenancy ID and Action into one entry, newest first, at most `HISTORY_SHOWN_LIMIT = 30`. `names` maps tenancy id → tenant from the page's tenancies (fallback "a past tenant").
- Copy:
  - entry titles:
    - "Details added for {tenant}."
    - "Details changed for {tenant}." (one line per field)
    - "{tenant} moved out on {date}." (lines for the other fields)
    - "{tenant}'s tenancy was closed on {date}, when the next tenant was added."
  - field lines:
    - "Phone number changed." / "Notes changed."
    - "{Field} set to {new}." / "{Field} removed (was {old})." / "{Field} changed from {old} to {new}."
    - days through `formatDay`, amounts through `formatRupees`; an unknown action reads "Change recorded: {Field}."
  - meta: "{formatSavedAt} · by you" / "· by {address}" / "· who: not recorded" (the Activity rule).
- Page: a "History" section after Past tenants: an `ol` of entries (title `text-sm font-medium`, lines `text-sm`, meta `text-sm text-muted`).
  - Empty: "No changes recorded yet.", then muted "Changes saved in the app from now on are listed here, newest first. Changes made straight in the Sheet are not."
  - Over the limit: "Showing the newest 30 changes. Older ones are in the Tenancy Log tab of your Sheet."
  - A failed read or a header problem: Notice warn "The history can't be shown right now. {reason}"; the rest of the page works.
- Tests:
  - each copy rule, the grouping and order, "by you" case-insensitive;
  - the page section in each state (mock `readTenancyHistory`; a deliberate addition to the existing mocks);
  - after an edit through the service, a fresh read shows it (FakeGateway: the write cleared the log cache).

### 4-12 The Tenancy Log in Set up and Diagnostics; docs

Files: wave 3's `src/lib/sheets/sheet-checks.ts`, `src/lib/diagnostics-view.ts`, `src/lib/server/setup-env.ts` and `src/lib/layout-rules.ts` (when they landed), `scripts/verify-testcopy.ts` (typecheck only), `SETUP.md`, `README.md`, `docs/product/THREAT-MODEL.md`, tests.

- `checkSheet` reads the Tenancy Log in its one `getManyValues` when the tab exists. New check `tenancy-log` (step 5):
  - ok: "Headers are right. {n} entries.";
  - todo: "Not created yet. It's added the next time the app opens your Sheet, or by Prepare my Sheet.";
  - warn: the header problem → "Put the headers back. Saving changes still works; only the History can't be shown.".
  - Facts gain `tenancyLogRows`. The fresh-Sheet test expects four todo tabs and Prepare lists four (deliberate). The canary test covers a Tenancy Log value.
- Diagnostics: "Tenancy Log: {n} entries, last saved {time}".
- `scripts/verify-testcopy.ts`: after its tenancy edit, check that the Tenancy Log's newest rows hold that edit. It is for the lead's run; here it only has to typecheck.
- `SETUP.md`:
  - the app tabs now include "Tenancy Log": what it holds; append-only; Phone and Notes recorded only as changed; may be hidden but not renamed or re-ordered;
  - the three new screens, and the overdue rule in one paragraph.
- `README.md` feature bullets: overdue rent, year at a glance, agreement and hike alerts, tenancy history.
- `THREAT-MODEL.md`: "The Tenancy Log records who changed tenancy details and when; phone numbers and notes are not copied into it."
- A doc test checks the SETUP paragraph names the same days as `RENT_DUE_DAY`, `OVERDUE_GRACE_DAYS` and `AGREEMENT_NOTICE_DAYS`.

### 4-13 Verify

1. Gates: `npm test`, `npm run typecheck`, `npm run lint`, `env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npm run build`. Working tree clean. Note the test count before and after.
2. `next start` smoke from a scratch copy, as in 3-17: symlink `node_modules`; `getSheetsContext` returns a FakeGateway; dummy env; session cookie minted with `@auth/core/jwt`.

   Seed (relative to today):
   - p1 paid with an agreement ending in 30 days;
   - p2 at the end of its cycle (hike due);
   - p3 unpaid for two months, its agreement ended last week;
   - p5 paid short;
   - a Tenancy Log with an Added, an Edited (agreement end and phone) and a Moved out entry.

   Check:
   - `/overdue`, `/year` and `/alerts` render for the owner and for a member;
   - the home card shows on this month and not on another;
   - an edit in the tenant page adds rows to the fake's Tenancy Log and shows in History;
   - with `failOn appendRows` for one call, the edit still saves and the automatic retry adds the rows exactly once;
   - the server output holds no tenant name, phone or note.
3. Playwright (Chromium, 390 × 844, light and dark), screenshots in the scratch dir:
   - the home screen with the Needs attention card;
   - `/overdue` and its empty state;
   - `/year` for this year, for a year with no records and for a Schedule starting mid-year;
   - `/alerts`, the tenant page with History, and More.

   No CSP violations in the console. Walks:
   - home card → Overdue → a month row → that month;
   - Year cell → that month;
   - Back returns each time; the tab bar shows Month on the three screens.
4. Report: the test count, every deviation, every deliberate test change, and what could not be verified:
   - whether a real `values.append` of several rows is all or nothing;
   - the real latency of the tenant page's extra read;
   - the overdue rule on the owner's real data (expect long lists where move-outs were never recorded);
   - `verify:testcopy` (the lead runs it).
