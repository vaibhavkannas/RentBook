# RentBook Wave B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store tenancy details (advance, agreement dates, phone, notes, move-out) in a `Tenants` tab of the same Google Sheet, show the important ones on each portion card, and give each portion a tenant details page with edit, move-out and past tenants.

**Architecture:** Same layers as wave A. Pure rules in `src/lib/domain`, the `Tenants` tab behind the existing `SheetsGateway` in `src/lib/sheets`, writes in the service with stale-screen checks, routes in `src/app/api`, small client components. The tenancies are read in the same parallel read as Settings and the Schedule, so they join the 15-second snapshot cache and its invalidation. All service logic is tested with `FakeGateway`.

**Tech Stack:** Next.js 16.3.8 (App Router), React 19.2.8, TypeScript 5 strict, Tailwind 4, Vitest 5, zod 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-wave-b-design.md`

## Global Constraints

- This is not the Next.js you know (`AGENTS.md`). Before using a Next API (dynamic route `params`, route handlers, `cookies`, client navigation), read the matching page under `node_modules/next/dist/docs/` and follow it. In this version `params` of a page is a Promise.
- Writes stay RAW. Time zone is `Asia/Kolkata`. Dates are `YYYY-MM-DD` text, amounts whole rupees (numbers).
- The Schedule tab layout and the existing payment, undo and count rules never change. `Payments Log` is unchanged.
- No real email address anywhere in the repository (code, tests, docs, commit messages). Use `owner@example.com` and `member@example.com`.
- Everyone on the allow-list may view and edit tenancy details. Every route uses `requireUser()`. Every tenancy change records `Updated by` (the signed-in email) and `Updated at` (ISO time).
- A stale screen must never overwrite a newer change: updates carry `expectedUpdatedAt`; a mismatch is a `conflict` and nothing is written. Conflicts and successes both go through `runWrite` (`src/lib/server/writes.ts`) in routes.
- Touch targets are at least 44 px (`min-h-11`, `min-w-11`). Use only the existing Tailwind colour tokens (`bg-surface`, `text-muted`, `bg-accent`, `text-accent-ink`, `bg-danger-bg`, `text-danger-ink`, `bg-warn-bg`, `text-warn-ink`, `bg-success-bg`, `text-success-ink`, `border-line`, `border-control`). Money is shown with `formatRupees`.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on branch `wave-b`. Never push.
- At the end of every task `npm test`, `npm run typecheck` and `npm run lint` pass (run from `D:\Repos\RentBook`; all 315 existing tests keep passing, updated only where a signature changes). Tasks 4 and 5 also run `npm run build` (if it fails fetching Google Fonts with a certificate error, retry with `NODE_OPTIONS=--use-system-ca npm run build`).
- Header rule (refines the spec): the `Tenants` tab must hold exactly the 15 headers below in columns A to O, in this order. Columns to the right of O may be added by hand and are ignored. A missing or different header is a `sheet-structure` error naming the header.

## The Tenants tab (columns A to O)

`Tenancy ID`, `Portion`, `Tenant`, `Phone`, `Move-in date`, `Agreement end`, `Advance`, `Advance date`, `Advance status`, `Refund`, `Deductions`, `Notes`, `Move-out date`, `Updated by`, `Updated at`.

## File Structure

New: `src/lib/domain/tenancy.ts`, `src/lib/sheets/tenants-store.ts`, `src/lib/sheets/tenancy-service.ts`, `src/lib/tenancy-chips.ts`, `src/app/api/tenancies/route.ts`, `src/app/api/tenancies/move-out/route.ts`, `src/app/tenants/[portionId]/page.tsx`, `src/components/TenancyForm.tsx`, `src/components/MoveOutForm.tsx`, and tests `tests/domain/tenancy.test.ts`, `tests/sheets/tenants-store.test.ts`, `tests/sheets/tenancy-service.test.ts`, `tests/domain/tenancy-chips.test.ts`.

Modified: `src/lib/domain/types.ts`, `src/lib/domain/month-view.ts`, `src/lib/sheets/settings-store.ts` (ensureTabs), `src/lib/sheets/service.ts`, `src/lib/server/schemas.ts`, `src/lib/payment-request.ts`, `src/lib/format.ts`, `src/components/PortionBoard.tsx`, `src/components/PaymentSheet.tsx`, `src/app/page.tsx` (only if needed), `scripts/verify-testcopy.ts`, `SETUP.md`, `README.md`, and the existing tests a signature change touches.

---

### Task 1: Tenancy domain rules and the Tenants tab store

**Files:**
- Create: `src/lib/domain/tenancy.ts`, `src/lib/sheets/tenants-store.ts`
- Modify: `src/lib/sheets/settings-store.ts` (`ensureTabs` also ensures the Tenants tab)
- Test: `tests/domain/tenancy.test.ts`, `tests/sheets/tenants-store.test.ts`; fix any existing test that counts tabs or gateway calls

**Interfaces (Produces):**

`src/lib/domain/tenancy.ts` (pure, no I/O):

```ts
export type AdvanceStatus = "Held" | "Refunded" | "Adjusted";

export type Tenancy = {
  /** 1-based row in the Tenants tab. Not stored. */
  rowNumber: number;
  id: string;
  portionId: string;
  tenant: string;
  phone: string;
  moveIn: string;        // YYYY-MM-DD
  agreementEnd: string;  // YYYY-MM-DD or ""
  advance: number | null;
  advanceDate: string;   // YYYY-MM-DD or ""
  advanceStatus: AdvanceStatus | null;
  refund: number | null;
  deductions: number | null;
  notes: string;
  moveOut: string;       // YYYY-MM-DD or "" while current
  updatedBy: string;
  updatedAt: string;     // ISO timestamp
};

/** What a portion card needs. */
export type TenancySummary = Pick<Tenancy, "id" | "phone" | "moveIn" | "agreementEnd" | "advance" | "advanceStatus" | "updatedAt">;

/** Fields a person can enter when creating or editing a tenancy. */
export type TenancyFields = {
  phone?: string;
  moveIn: string;
  agreementEnd?: string;
  advance?: number | null;
  advanceDate?: string;
  notes?: string;
};

export const MAX_RUPEES = 10_000_000;

export function sameTenantName(a: string, b: string): boolean;               // trim + case-insensitive
export function currentTenancy(all: Tenancy[], portionId: string): Tenancy | null; // LAST row of the portion with moveOut === ""
export function pastTenancies(all: Tenancy[], portionId: string): Tenancy[];       // moveOut !== "", newest moveOut first, ties by higher rowNumber first
export function summarize(t: Tenancy): TenancySummary;
export function newTenancyId(now: Date, random?: () => number): string;            // "t-" + base36(ms) + 4 random base36 chars
/** Returns cleaned fields or throws validation() with a clear message. */
export function validateTenancyFields(fields: TenancyFields): Required<Omit<TenancyFields, "advance">> & { advance: number | null };
export function validateTenantName(name: string): string;                          // trimmed, 1 to 60 chars
```

Validation rules (all throw `validation(message)` from `@/lib/errors`): phone at most 20 characters and only digits, spaces, `+`, `-`, `(`, `)`; `moveIn` required and a real day (`isValidIsoDay`); `agreementEnd` and `advanceDate` optional, real days when present; `agreementEnd` not before `moveIn`; `advance` null/undefined or a whole number 0 to `MAX_RUPEES`; `notes` at most 500 characters. Trim all text.

`src/lib/sheets/tenants-store.ts`:

```ts
export const TENANTS_TAB = "Tenants";
export const TENANT_HEADERS: string[];   // the 15 headers above
/** Creates the tab with headers when missing; throws sheetStructure() naming a wrong or missing header. */
export async function ensureTenantsTab(gateway: SheetsGateway, existingTabs: string[]): Promise<void>;
export async function readTenancies(gateway: SheetsGateway): Promise<Tenancy[]>;
export async function appendTenancy(gateway: SheetsGateway, row: Omit<Tenancy, "rowNumber">): Promise<void>;
export async function writeTenancy(gateway: SheetsGateway, rowNumber: number, row: Omit<Tenancy, "rowNumber">): Promise<void>; // one updateValues call over A{r}:O{r}
```

`readTenancies` reads `A1:O` with `UNFORMATTED_VALUE`, skips the header and fully blank rows (but keeps true row numbers), reads numbers only from numeric cells (otherwise null), reads text with `String(...)`, and reads `advanceStatus` only if it is one of the three values (otherwise null). Stored rows have amounts as numbers or `""` for null.

`ensureTabs` in `settings-store.ts` calls `ensureTenantsTab(gateway, tabs)` once per gateway (inside the existing bootstrap).

- [ ] **Step 1: Write the failing tests.**

`tests/domain/tenancy.test.ts` must cover: `sameTenantName` (case and spaces); `currentTenancy` returns the last row with no move-out for that portion and ignores other portions and closed rows, and null when none; `pastTenancies` order; `summarize`; `newTenancyId` shape and determinism with an injected `random`; `validateTenancyFields` happy path with trimming and every rule above failing with a clear message (phone with a letter, phone 21 chars, bad move-in, agreement end before move-in, advance 1.5, advance -1, advance 10,000,001, notes 501 chars, bad advance date); `validateTenantName` rejects empty and 61 characters.

`tests/sheets/tenants-store.test.ts` (use `FakeGateway` from `tests/support/fake-gateway.ts` and the fixtures): creates the tab with the 15 headers when missing and does not touch an existing correct tab; throws `sheet-structure` naming the first wrong header (for example `Move-in date` replaced by `Moved in`); reading skips blank rows and keeps row numbers; reading parses numbers, blanks and an unknown status to null; `appendTenancy` then `readTenancies` round-trips every field; `writeTenancy` rewrites exactly one row with exactly one `updateValues` call and leaves other rows untouched; text that starts with `=` is stored as text (RAW). Add a test in `tests/sheets/settings-store.test.ts` that `ensureTabs` creates the Tenants tab.

- [ ] **Step 2: Run to confirm failure.** `npx vitest run tests/domain/tenancy.test.ts tests/sheets/tenants-store.test.ts` fails because the modules are missing.
- [ ] **Step 3: Implement** the two modules and the `ensureTabs` hook as specified. Reuse `isValidIsoDay` from `@/lib/domain/year-month`, `validation` and `sheetStructure` from `@/lib/errors`.
- [ ] **Step 4: Run everything.** `npm test && npm run typecheck && npm run lint` pass.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat: tenancy rules and the Tenants tab store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tenancy service, snapshot and card summary

**Files:**
- Create: `src/lib/sheets/tenancy-service.ts`
- Modify: `src/lib/domain/types.ts`, `src/lib/domain/month-view.ts`, `src/lib/sheets/service.ts`
- Test: `tests/sheets/tenancy-service.test.ts`, `tests/domain/month-view.test.ts`, `tests/sheets/cache.test.ts` (extend), existing service tests as needed

**Interfaces:**

Consumes: Task 1 exports; `SheetsContext`, `Snapshot`, `LogPaymentOptions` from `service.ts`.

Produces:
- `types.ts`: `PortionCard` gains `tenancy: TenancySummary | null`.
- `month-view.ts`: `deriveMonthView(rows, portions, month, tenancies: Tenancy[] = [])`. A card's tenant name is `entry?.tenant ?? next?.tenant`. `card.tenancy` is `summarize(current)` when `currentTenancy(tenancies, portion.id)` exists and `sameTenantName(current.tenant, name)`, otherwise null (also null for a card with no tenant).
- `service.ts`: `Snapshot` gains `tenancies: Tenancy[]`; `load` reads Settings, the Schedule and `readTenancies` in one `Promise.all`; `load` is exported as `loadSnapshot`; `getMonthView` passes `snapshot.tenancies` to `deriveMonthView`. `LogPaymentInput` gains optional `tenancy?: TenancyFields` (only meaningful with `newTenantName`). `LogPaymentResult` gains `tenancyWritten?: boolean` (absent when the call did not involve tenancies).
- `tenancy-service.ts`:

```ts
export type SaveTenancyInput = {
  portionId: string;
  tenant: string;              // used only when creating
  fields: TenancyFields;
  id?: string;                 // present = update that tenancy
  expectedUpdatedAt?: string;  // required when id is present
};
export async function saveTenancy(ctx: SheetsContext, input: SaveTenancyInput, options: { now: Date; updatedBy: string }): Promise<{ tenancy: Tenancy }>;

export type MoveOutInput = {
  id: string;
  expectedUpdatedAt: string;
  moveOut: string;                         // YYYY-MM-DD
  advanceStatus?: AdvanceStatus | null;
  refund?: number | null;
  deductions?: number | null;
  notes?: string;
};
export async function moveOutTenancy(ctx: SheetsContext, input: MoveOutInput, options: { now: Date; updatedBy: string }): Promise<{ tenancy: Tenancy }>;

export type PortionTenants = {
  portion: PortionConfig;
  /** Tenant named in the Schedule's latest entry for this portion, or null. */
  scheduleTenant: string | null;
  /** Current tenancy only when its tenant matches scheduleTenant. */
  current: Tenancy | null;
  /** A current tenancy on file for a different tenant name (will be closed when new details are added). */
  mismatched: Tenancy | null;
  past: Tenancy[];
};
export async function getPortionTenants(ctx: SheetsContext, portionId: string, options?: { minFetchedAt?: number }): Promise<PortionTenants>; // uses ctx.cache like getMonthView; throws validation() for an unknown portion
```

Behaviour:
- `saveTenancy` create (no `id`): validate the tenant name and fields; the portion must exist; read fresh data with `loadSnapshot(ctx)` (never the cache). If the portion already has a current tenancy whose tenant name matches, throw `conflict("Details already exist for X. Refresh the page.")`. Append the new row first, then, if a current tenancy for a different name exists, close it with `moveOut = max(old.moveIn, fields.moveIn)` (one `writeTenancy` call). `updatedBy`/`updatedAt` set from options.
- `saveTenancy` update (`id` present): the tenancy must exist, have no move-out and belong to `portionId`; `expectedUpdatedAt` must equal the stored `updatedAt` else `conflict("... was changed by someone else. Refresh the page and try again.")`. Only the editable fields change (phone, moveIn, agreementEnd, advance, advanceDate, notes); tenant, status, refund, deductions, moveOut stay. If `advance` becomes null the status becomes null; if it becomes a number and the status was null the status becomes `"Held"`. One `writeTenancy` call.
- `moveOutTenancy`: same existence and stale checks; refused with `conflict` if already closed. `moveOut` must be a real day not before `moveIn`. `refund` and `deductions` null or whole numbers 0 to `MAX_RUPEES`. `advanceStatus` is stored only when the tenancy has an advance (otherwise null); when it has an advance and none is given, keep the existing status. Notes replace the notes when provided.
- Both functions call `ctx.cache?.invalidate()` in a `finally`.
- `logPayment` (in `service.ts`), only when `newTenantName` is set and after the Schedule and Payments Log writes: build the tenancy work from the freshly loaded snapshot: if `input.tenancy` is given, append a new tenancy for `{ portionId, tenant: newTenant, fields: input.tenancy }`; then close the portion's previous current tenancy (if any, and its tenant name differs or no new row was created) with `moveOut = max(prev.moveIn, input.tenancy?.moveIn ?? input.dateReceived)`. If anything in this tenancy work throws, catch it, set `tenancyWritten: false` and continue (the payment is already saved). On success set `tenancyWritten: true`. Without `newTenantName`, `tenancyWritten` is absent. Reuse `saveTenancy` internals through a shared helper; do not duplicate validation. Validate `input.tenancy` BEFORE any Schedule write so bad details refuse the whole request.

- [ ] **Step 1: Write the failing tests.**

`tests/sheets/tenancy-service.test.ts` (FakeGateway with `baseSchedule()`; the Tenants tab appears through `ensureTabs`): create appends one row with id, portion, name, fields, updatedBy, updatedAt; create twice for the same current tenant is a conflict; create for a different name closes the previous row (`moveOut` set) and the order of writes is append then close; update changes only editable fields and refreshes `updatedAt`; update with a wrong `expectedUpdatedAt` is a conflict and writes nothing; update of a closed tenancy refused; update of another portion's id refused; advance cleared to null clears the status; advance added sets `Held`; move-out sets date, status, refund, deductions and keeps notes unless replaced; move-out before move-in refused; move-out of a closed tenancy refused (conflict); move-out with stale `expectedUpdatedAt` refused; `getPortionTenants` returns current only when the name matches, `mismatched` otherwise, and `past` newest first, and unknown portion throws validation; text starting with `=` stays text. `logPayment` with `newTenantName` and `tenancy` writes the Schedule cells, the log row and a tenancy row, closes the previous tenancy, and returns `tenancyWritten: true`; with `newTenantName` and no `tenancy` only closes the previous one; invalid `tenancy` fields refuse the request and change nothing (Schedule and Payments Log untouched); when the Tenants write fails (`fake.failOn.add("appendRow")` is shared with the log, so instead make `updateValues`/`appendRow` fail selectively by wrapping the fake, or fail the Tenants tab read after the payment: choose a reliable way and document it in the test) the payment stays saved and the result has `tenancyWritten: false`.

`tests/domain/month-view.test.ts`: card `tenancy` is the summary when the names match (case-insensitive), null when the names differ, null when there is no tenant, and the previous behaviour is unchanged when `tenancies` is omitted. `tests/sheets/cache.test.ts`: a saved tenancy shows on the next `getMonthView` (invalidation works) and repeated month views still read the Sheet once (now three reads: Settings, Schedule, Tenants).

- [ ] **Step 2: Run to confirm failure.** `npx vitest run tests/sheets tests/domain` fails on the missing exports.
- [ ] **Step 3: Implement** as specified. Keep `service.ts` readable: put the tenancy functions in `tenancy-service.ts` and import `loadSnapshot` from `service.ts`; keep the small logPayment hook in `service.ts` calling an exported helper from `tenancy-service.ts` (avoid a circular import by passing what it needs as arguments, or by moving shared types to a third module).
- [ ] **Step 4: Run everything.** `npm test && npm run typecheck && npm run lint` pass.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat: save tenancies, move out, and show a tenancy summary on cards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: API routes and request schemas

**Files:**
- Create: `src/app/api/tenancies/route.ts`, `src/app/api/tenancies/move-out/route.ts`
- Modify: `src/lib/server/schemas.ts`, `src/lib/payment-request.ts`, `src/app/api/payments/route.ts`
- Test: `tests/server/routes.test.ts` (extend), `tests/domain/payment-request.test.ts` (extend)

**Interfaces:**
- Produces `schemas.ts`: `tenancyFieldsSchema` (zod object: `phone?: string`, `moveIn: string`, `agreementEnd?: string`, `advance?: number | null`, `advanceDate?: string`, `notes?: string`), `tenancyBody` (`{ portionId: string min 1 max 20, tenant: string, id?: string, expectedUpdatedAt?: string, fields: tenancyFieldsSchema }`), `moveOutBody` (`{ id, expectedUpdatedAt, moveOut, advanceStatus?: "Held"|"Refunded"|"Adjusted"|null, refund?: number|null, deductions?: number|null, notes?: string }`). `paymentBody` gains optional `tenancy: tenancyFieldsSchema`.
- `POST /api/tenancies`: `requireUser()`, parse `tenancyBody`, `runWrite(() => saveTenancy(getSheetsContext(), body, { now: new Date(), updatedBy: viewer.email }))`, return `{ tenancy }`. A body with `id` but no `expectedUpdatedAt` is a 400.
- `POST /api/tenancies/move-out`: same pattern with `moveOutTenancy`.
- `POST /api/payments` passes `body.tenancy` to `logPayment` as `tenancy`; the response includes `tenancyWritten` from the result.
- `payment-request.ts`: `buildPaymentRequest` (read it first) accepts an optional `tenancy` for the new-tenant mode and includes it in the request body only when at least one field is non-empty.

- [ ] **Step 1: Write the failing tests** in `tests/server/routes.test.ts` (reuse its mocking pattern: mock `@/auth`, `@/lib/server/context`, `@/lib/server/freshness`, and the service module; add `saveTenancy`, `moveOutTenancy` mocks via `vi.hoisted`): for each new route: no session gives 401 and the service is not called; an address not on the list gives 401; a listed member succeeds and the service receives `updatedBy` equal to the lower-cased email; a malformed body gives 400 (missing `portionId`, bad `moveIn` type, `id` without `expectedUpdatedAt`); a conflict from the service gives 409 and `markWritten` is still called (same as the payment routes). `POST /api/payments` passes `tenancy` through and returns `tenancyWritten`. Extend `tests/domain/payment-request.test.ts` for the optional `tenancy`.
- [ ] **Step 2: Run to confirm failure.** `npx vitest run tests/server tests/domain/payment-request.test.ts`.
- [ ] **Step 3: Implement** the schemas, the routes and the payment changes.
- [ ] **Step 4: Run everything.** `npm test && npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** with message `feat: tenancy API routes` (and the trailer).

---

### Task 4: UI: card chips, details page, forms, New tenant fields

**Files:**
- Create: `src/lib/tenancy-chips.ts`, `src/app/tenants/[portionId]/page.tsx`, `src/components/TenancyForm.tsx`, `src/components/MoveOutForm.tsx`
- Modify: `src/lib/format.ts` (add `formatDay(iso: string): string` giving `15 Mar 2027`, returns the input when it does not parse), `src/components/PortionBoard.tsx`, `src/components/PaymentSheet.tsx`
- Test: `tests/domain/tenancy-chips.test.ts`, `tests/domain/format.test.ts` (extend)

**Interfaces:**
- `tenancy-chips.ts`: `tenancyChips(summary: TenancySummary): string[]`. Advance with status `Held` and amount shows `Advance ₹ 20,000 held` (use `formatRupees`); `Refunded` shows `Advance returned`; `Adjusted` shows `Advance adjusted`; a null advance shows nothing. A non-empty `agreementEnd` adds `Agreement ends 15 Mar 2027` (use `formatDay`). Order: advance first, then agreement. Pure and unit tested.
- `PortionBoard.tsx`: under the tenant line show a `Details` link (`next/link`, `href=/tenants/${card.portionId}`, `min-h-11` tap target) for any card that has a tenant; show the chips as small pills (`bg-line text-foreground` style, same size as the status pill); when the card has a tenant but `card.tenancy === null`, show an `Add details` link to the same page instead of chips. A `needs-tenant` card shows none of this.
- `/tenants/[portionId]` page (server component, read the Next docs for async `params` first): guard with `getViewer()` (redirect to `/signin`); `readWrittenAt()` for `minFetchedAt`; `getPortionTenants`; unknown portion: `notFound()`; failures use the existing `LoadProblem` component. Layout: back link to `/`, portion name, scheduled tenant name. Section "Current tenancy": when `current` exists show a read view (phone, move-in, agreement end, advance with status, notes, last updated by and when) plus an `Edit` button that reveals `TenancyForm` in edit mode; when there is no current tenancy show `TenancyForm` in create mode headed "Add details" (if `mismatched` exists show a short note that earlier details for another tenant will be marked as moved out). Section "Move out" (only when `current` exists): a button revealing `MoveOutForm`. Section "Past tenants": read-only list newest first (name, move-in to move-out, advance outcome with refund and deductions when present); empty state "No past tenants yet.".
- `TenancyForm` (client): fields phone, move-in (date input, default today in create mode), agreement end (date), advance (number), advance date (date), notes (textarea, max 500). Posts to `/api/tenancies` with `fetch`, create mode sends `{ portionId, tenant: scheduleTenant, fields }`, edit mode sends `{ portionId, tenant, id, expectedUpdatedAt, fields }`. On success `router.refresh()` and close the form. Errors in a `role="alert"` block; a `conflict` also refreshes the page and says `This changed just now. The page was updated, please check and save again.`. Disable the button while saving. Follow the field styling of `SettingsForm.tsx`.
- `MoveOutForm` (client): move-out date (default today), advance outcome (select Refunded, Adjusted, Held; shown only when the tenancy has an advance), refund, deductions, notes; posts to `/api/tenancies/move-out`; same error handling.
- `PaymentSheet.tsx` new-tenant mode: add a collapsed `<details>` section "Tenancy details (optional)" with move-in date (default `defaultDate`), advance, advance date, agreement end, phone. Include them via `buildPaymentRequest` only when at least one is filled. If the response has `tenancyWritten === false`, show a warning: `Payment saved, but the tenancy details didn't save. Add them from the Details page.` (use the same warning style as the Payments Log retry notice) before closing.

- [ ] **Step 1: Write the failing tests** for `tenancyChips` (every status, null advance, agreement end, order, empty summary) and `formatDay`.
- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement** helpers, components, page and the PortionBoard and PaymentSheet changes. There is no component test setup in this repository: keep logic in pure helpers with tests, and keep components thin. Check keyboard focus order and `aria-` attributes on the new forms (labels tied to inputs, `aria-live` or `role="alert"` for errors).
- [ ] **Step 4: Run everything.** `npm test && npm run typecheck && npm run lint && npm run build`; the build lists `/tenants/[portionId]` and `/api/tenancies` routes.
- [ ] **Step 5: Commit** with message `feat: tenant details page, card chips and New tenant details` (and the trailer).

---

### Task 5: Test-copy check script and docs

**Files:**
- Modify: `scripts/verify-testcopy.ts`, `SETUP.md`, `README.md`, `docs/superpowers/specs/2026-10-07-wave-b-design.md` (status line, and the header-rule refinement from Global Constraints)

- [ ] **Step 1: Extend `scripts/verify-testcopy.ts`.** After the existing checks, using portion `p5` and month 2040-04 as before: log a new tenant payment WITH tenancy details (move-in, advance 5000, agreement end, phone) and check `tenancyWritten === true` and that `getMonthView` shows `card.tenancy` with the advance; edit the tenancy through `saveTenancy` (change notes) and check `updatedAt` changed; a second save with the OLD `expectedUpdatedAt` must throw a conflict; move out through `moveOutTenancy` (Refunded, refund 5000) and check `getPortionTenants(...).past` has it and `current` is null; undo the payment as before. Keep the script's existing guards (refuses the real Sheet, checks the 2040-04 row first). The Tenants rows it creates stay in the test copy; say so in the script header and the README line. Do NOT run this script (the lead runs it).
- [ ] **Step 2: Docs.** `SETUP.md`: a short section "Tenant details" saying the app creates a `Tenants` tab automatically, the 15 headers must stay in columns A to O in order, new columns may be added to the right, rows can be edited by hand, and move-out dates/advance status values (`Held`, `Refunded`, `Adjusted`). `README.md`: one line for the feature. Update the wave B spec status to `approved; implemented per docs/superpowers/plans/2026-10-07-wave-b-implementation.md` and change the "Header names are matched by text" bullet to the fixed-order rule.
- [ ] **Step 3: Run everything.** `npm test && npm run typecheck && npm run lint`.
- [ ] **Step 4: Commit** with message `docs: tenant details setup notes; extend the test-copy check` (and the trailer).

---

### Task 6: Verify, review, merge and deploy (run by the lead, not a subagent)

- [ ] Full verification on the branch: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- [ ] Whole-branch review by independent reviewers (spec coverage; correctness and safety; phone UX and accessibility). Fix every critical and important finding and re-verify.
- [ ] Scan the branch diff for real email addresses: only `example.com` placeholders may appear.
- [ ] Run `npm run verify:testcopy` with `TEST_SHEET_ID` set to the test copy. Every line must PASS.
- [ ] Merge `wave-b` into `main` (fast-forward), run the tests on `main`, push, wait for the Vercel deployment to be Ready, and check the live site loads for the signed-in owner (the Tenants tab appears in the real Sheet on first load).
- [ ] Report what was verified, what was not (phone, other accounts), and the rollback (revert the merge on `main`; the extra `Tenants` tab is harmless).
