# RentBook Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add faster and clearer month switching, undo for a logged payment, multi-person sign-in with an owner, and a "Logged by" audit trail with an Activity screen.

**Architecture:** Keep the existing layers: pure domain code in `src/lib/domain`, Google Sheets access behind `SheetsGateway` in `src/lib/sheets`, route handlers and guards in `src/lib/server` and `src/app/api`, and small client components in `src/components`. All Sheet logic is tested against `FakeGateway`. A per-instance snapshot cache with a "last write" cookie makes month switching fast while keeping read-your-writes.

**Tech Stack:** Next.js 16.3.8 (App Router), React 19.2.8, TypeScript 5 strict, Tailwind 4, Vitest 5, zod 4, `next-auth@5.0.0-beta.32`, `@googleapis/sheets`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-wave-a-design.md`

## Global Constraints

- This is not the Next.js you know (`AGENTS.md`). Before writing code that touches a Next API (`cookies`, `useRouter`, `useTransition`, route handlers, metadata), read the matching page under `node_modules/next/dist/docs/` and follow it. `cookies()` from `next/headers` is async.
- The Schedule tab layout never changes. Writes stay RAW. Time zone is `Asia/Kolkata`.
- Payments Log gets exactly two new columns, H `Logged by` and I `Action` (`Logged`, `Edited`, `Undone`). Existing rows keep blanks there.
- `ALLOWED_EMAILS` (comma, space or semicolon separated, case-insensitive) lists who may sign in. The first address is the owner. `ALLOWED_EMAIL` is used only when `ALLOWED_EMAILS` is empty or missing. No real addresses may appear anywhere in the repository, in code, tests, docs or examples. Use `owner@example.com` and `member@example.com`.
- Everyone on the list may log, edit, undo and read Activity. Only the owner may open Portion settings or call `PUT /api/settings`.
- Cache lifetime is 15 seconds. Writes never read from the cache. Every write clears it.
- Touch targets are at least 44 px (`min-h-11` and `min-w-11`). Use the existing Tailwind colour tokens (`bg-surface`, `text-muted`, `bg-accent`, `text-accent-ink`, `bg-danger-bg`, `text-danger-ink`, `bg-warn-bg`, `text-warn-ink`, `bg-success-bg`, `text-success-ink`, `border-line`, `border-control`). They already support dark mode.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. The git identity is already set. Work on branch `wave-a`.
- All 171 existing tests keep passing (updated where a signature changes). `npm test`, `npm run typecheck` and `npm run lint` pass at the end of every task. Run them from `D:\Repos\RentBook`.
- Money is whole rupees formatted with `formatRupees` (`en-IN`).

## File Structure

New files:

- `src/lib/month-nav.ts`: pure helpers for the month picker, links and swipe.
- `src/lib/sheets/snapshot-cache.ts`: generic time-limited cache with a minimum-freshness check.
- `src/lib/server/freshness.ts`: the "last write" cookie.
- `src/app/api/payments/undo/route.ts`: undo endpoint.
- `src/app/activity/page.tsx`: Activity screen.
- `src/components/MonthFrame.tsx`, `src/components/MonthPicker.tsx`: month navigation UI.
- `src/components/UndoSheet.tsx`: undo confirmation.
- `scripts/verify-testcopy.ts`: end-to-end check against the test copy of the Sheet.
- Tests: `tests/server/routes.test.ts`, `tests/sheets/undo.test.ts`, `tests/sheets/activity.test.ts`, `tests/sheets/snapshot-cache.test.ts`, `tests/sheets/cache.test.ts`, `tests/domain/month-nav.test.ts`, `tests/server/freshness.test.ts`.

Modified files: `src/lib/errors.ts`, `src/lib/server/{env,auth-guard,http,schemas}.ts`, `src/auth.ts`, `src/lib/domain/{types,month-view}.ts`, `src/lib/sheets/{service,settings-store}.ts`, `src/lib/server/context.ts`, `src/lib/format.ts`, `src/app/page.tsx`, `src/app/settings/page.tsx`, `src/app/api/{payments,payments/log-retry,settings}/route.ts`, `src/components/PortionBoard.tsx`, `.env.example`, `SETUP.md`, `README.md`, `package.json`, and the existing tests that the signature changes touch.

---

### Task 1: Allow-list, owner and guards

**Files:**
- Modify: `src/lib/errors.ts`, `src/lib/server/env.ts`, `src/lib/server/auth-guard.ts`, `src/lib/server/http.ts`, `src/auth.ts`, `src/app/page.tsx`, `src/app/settings/page.tsx`, `src/app/api/settings/route.ts`, `src/app/api/payments/route.ts`, `src/app/api/payments/log-retry/route.ts`, `.env.example`
- Test: `tests/server/env.test.ts`, `tests/server/http.test.ts`, `tests/server/routes.test.ts` (new)

**Interfaces:**
- Produces (`src/lib/server/env.ts`): `parseAllowedEmails(env: Record<string, string | undefined>): string[]`, `isAllowedEmail(email: string | null | undefined, allowedEmails: readonly string[], emailVerified?: boolean | null): boolean`, `isOwnerEmail(email: string | null | undefined, allowedEmails: readonly string[]): boolean`. `AppEnv` loses `allowedEmail` and gains `allowedEmails: string[]`.
- Produces (`src/lib/server/auth-guard.ts`): `type Viewer = { email: string; isOwner: boolean }`, `getViewer(): Promise<Viewer | null>`, `requireUser(): Promise<Viewer>`, `requireOwner(): Promise<Viewer>`. `isSignedIn` is removed.
- Produces (`src/lib/errors.ts`): `forbidden(): AppError` with code `"forbidden"`, HTTP status 403.

- [ ] **Step 1: Write the failing env tests**

Replace the whole of `tests/server/env.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedEmail, isOwnerEmail, parseAllowedEmails, readEnv } from "@/lib/server/env";

describe("parseAllowedEmails", () => {
  it("splits on commas, spaces and semicolons, lower-cases, and removes duplicates", () => {
    expect(
      parseAllowedEmails({ ALLOWED_EMAILS: " Owner@Example.com, member@example.com;  OWNER@example.com\nother@example.com " }),
    ).toEqual(["owner@example.com", "member@example.com", "other@example.com"]);
  });

  it("falls back to ALLOWED_EMAIL only when ALLOWED_EMAILS is empty or missing", () => {
    expect(parseAllowedEmails({ ALLOWED_EMAIL: "Me@Example.com" })).toEqual(["me@example.com"]);
    expect(parseAllowedEmails({ ALLOWED_EMAILS: "  ", ALLOWED_EMAIL: "me@example.com" })).toEqual([
      "me@example.com",
    ]);
    expect(
      parseAllowedEmails({ ALLOWED_EMAILS: "a@example.com", ALLOWED_EMAIL: "me@example.com" }),
    ).toEqual(["a@example.com"]);
  });

  it("returns an empty list when nothing is set", () => {
    expect(parseAllowedEmails({})).toEqual([]);
  });
});

describe("readEnv", () => {
  const base = {
    GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
    SHEET_ID: "abc",
    TOTAL_HEADER: "Per Month",
    ALLOWED_EMAILS: "Owner@Example.com, member@example.com",
  };

  it("reads required values and applies defaults", () => {
    expect(readEnv(base)).toMatchObject({
      sheetId: "abc",
      scheduleTab: "Schedule",
      totalHeader: "Per Month",
      allowedEmails: ["owner@example.com", "member@example.com"],
    });
    expect(readEnv({ ...base, SCHEDULE_TAB: "Rent" }).scheduleTab).toBe("Rent");
  });

  it("still accepts the old single ALLOWED_EMAIL", () => {
    const { ALLOWED_EMAILS: _drop, ...rest } = base;
    expect(readEnv({ ...rest, ALLOWED_EMAIL: "Me@Example.com" }).allowedEmails).toEqual([
      "me@example.com",
    ]);
  });

  it("lists every missing variable together", () => {
    expect(() => readEnv({ SHEET_ID: "abc" })).toThrow(
      "Missing environment variables: GOOGLE_SERVICE_ACCOUNT_JSON, TOTAL_HEADER, ALLOWED_EMAILS.",
    );
  });

  it("treats blank values as missing", () => {
    expect(() => readEnv({ ...base, SHEET_ID: "   " })).toThrow(/SHEET_ID/);
  });
});

describe("isAllowedEmail", () => {
  const allowed = ["owner@example.com", "member@example.com"];

  it("allows only listed, verified addresses (case-insensitive)", () => {
    expect(isAllowedEmail("Owner@Example.com", allowed)).toBe(true);
    expect(isAllowedEmail("member@example.com", allowed)).toBe(true);
    expect(isAllowedEmail("other@example.com", allowed)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, false)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, null)).toBe(false);
    expect(isAllowedEmail("owner@example.com", allowed, true)).toBe(true);
    expect(isAllowedEmail(undefined, allowed)).toBe(false);
    expect(isAllowedEmail("owner@example.com", [])).toBe(false);
  });
});

describe("isOwnerEmail", () => {
  it("is true only for the first listed address", () => {
    const allowed = ["owner@example.com", "member@example.com"];
    expect(isOwnerEmail("OWNER@example.com", allowed)).toBe(true);
    expect(isOwnerEmail("member@example.com", allowed)).toBe(false);
    expect(isOwnerEmail(undefined, allowed)).toBe(false);
    expect(isOwnerEmail("owner@example.com", [])).toBe(false);
  });
});
```

Open `tests/server/http.test.ts`, find where it checks the status mapping for each error code, and add a case that `forbidden()` produces HTTP 403 with `error.code === "forbidden"`.

- [ ] **Step 2: Write the failing route tests**

Create `tests/server/routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const saveSettings = vi.hoisted(() => vi.fn(async () => []));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/sheets/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sheets/service")>()),
  saveSettings,
}));

import { PUT as putSettings } from "@/app/api/settings/route";

const settingsRequest = () =>
  new Request("http://localhost/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      portions: [{ id: "p1", name: "Ground", cycleLength: 11, hikePercent: 5 }],
    }),
  });

const signedInAs = (email: string | null) =>
  auth.mockResolvedValue(email ? { user: { email } } : null);

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.ALLOWED_EMAILS;
  process.env.ALLOWED_EMAILS = "owner@example.com, member@example.com";
  saveSettings.mockClear();
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = savedEnv;
});

describe("PUT /api/settings", () => {
  it("rejects a visitor who is not signed in", async () => {
    signedInAs(null);
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("rejects a signed-in address that is not on the list", async () => {
    signedInAs("stranger@example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(401);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("rejects a listed member who is not the owner", async () => {
    signedInAs("member@example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("lets the owner save", async () => {
    signedInAs("Owner@Example.com");
    const res = await putSettings(settingsRequest());
    expect(res.status).toBe(200);
    expect(saveSettings).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run tests/server`
Expected: FAIL (`parseAllowedEmails` is not exported, `forbidden` is missing, `requireOwner` is missing).

- [ ] **Step 4: Implement**

`src/lib/errors.ts`: add `"forbidden"` to the code union and, after `unauthorized`:

```ts
export const forbidden = () => new AppError("forbidden", "Only the owner can do that.");
```

`src/lib/server/http.ts`: add `forbidden: 403,` to the `STATUS` map.

Replace `src/lib/server/env.ts` with:

```ts
import { configError } from "@/lib/errors";

export type AppEnv = {
  serviceAccountJson: string;
  sheetId: string;
  scheduleTab: string;
  totalHeader: string;
  /** Lower-cased, without duplicates. The first address is the owner. */
  allowedEmails: string[];
};

const REQUIRED = ["GOOGLE_SERVICE_ACCOUNT_JSON", "SHEET_ID", "TOTAL_HEADER"] as const;

/**
 * Addresses allowed to sign in, from ALLOWED_EMAILS (commas, spaces or semicolons).
 * The old single ALLOWED_EMAIL is used only when ALLOWED_EMAILS is empty or missing.
 */
export function parseAllowedEmails(env: Record<string, string | undefined>): string[] {
  const raw = env.ALLOWED_EMAILS?.trim() ? env.ALLOWED_EMAILS : env.ALLOWED_EMAIL;
  const emails = (raw ?? "")
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

/** Reads and checks the environment. Lists every missing variable at once. */
export function readEnv(env: Record<string, string | undefined>): AppEnv {
  const missing: string[] = REQUIRED.filter((name) => !env[name]?.trim());
  const allowedEmails = parseAllowedEmails(env);
  if (allowedEmails.length === 0) missing.push("ALLOWED_EMAILS");
  if (missing.length > 0) {
    throw configError(`Missing environment variables: ${missing.join(", ")}.`);
  }
  return {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON!.trim(),
    sheetId: env.SHEET_ID!.trim(),
    scheduleTab: env.SCHEDULE_TAB?.trim() || "Schedule",
    totalHeader: env.TOTAL_HEADER!.trim(),
    allowedEmails,
  };
}

const norm = (value: string) => value.trim().toLowerCase();

/** True only for a listed address that Google has verified. */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedEmails: readonly string[],
  emailVerified: boolean | null | undefined = true,
): boolean {
  if (!email || allowedEmails.length === 0 || emailVerified === false || emailVerified === null) {
    return false;
  }
  const wanted = norm(email);
  return allowedEmails.some((allowed) => norm(allowed) === wanted);
}

/** The owner is the first listed address. */
export function isOwnerEmail(
  email: string | null | undefined,
  allowedEmails: readonly string[],
): boolean {
  return !!email && allowedEmails.length > 0 && norm(allowedEmails[0]) === norm(email);
}
```

Replace `src/lib/server/auth-guard.ts` with:

```ts
import { auth } from "@/auth";
import { forbidden, unauthorized } from "@/lib/errors";
import { isAllowedEmail, isOwnerEmail, parseAllowedEmails } from "./env";

export type Viewer = { email: string; isOwner: boolean };

/** The signed-in person if they are on the allow-list, otherwise null. Checked on every call. */
export async function getViewer(): Promise<Viewer | null> {
  const session = await auth();
  const email = session?.user?.email;
  const allowed = parseAllowedEmails(process.env);
  if (!email || !isAllowedEmail(email, allowed)) return null;
  return { email: email.trim().toLowerCase(), isOwner: isOwnerEmail(email, allowed) };
}

export async function requireUser(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw unauthorized();
  return viewer;
}

export async function requireOwner(): Promise<Viewer> {
  const viewer = await requireUser();
  if (!viewer.isOwner) throw forbidden();
  return viewer;
}
```

`src/auth.ts`: import `parseAllowedEmails` next to `isAllowedEmail` and change the callback to:

```ts
    signIn({ profile }) {
      return isAllowedEmail(
        profile?.email,
        parseAllowedEmails(process.env),
        profile?.email_verified === true,
      );
    },
```

Also change the doc comment to say "restricted to ALLOWED_EMAILS".

`src/app/api/settings/route.ts`: replace `requireUser` with `requireOwner` (import and call).

`src/app/page.tsx`: replace the import of `isSignedIn` with `getViewer`, and replace `if (!(await isSignedIn())) redirect("/signin");` with:

```ts
  if (!(await getViewer())) redirect("/signin");
```

(Task 7 changes this to keep the viewer for the footer.)

`src/app/settings/page.tsx`: replace the `isSignedIn` check with:

```ts
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!viewer.isOwner) redirect("/");
```

The payments and log-retry routes keep `await requireUser();` and need no change in this task (Task 2 starts using the returned value).

Search the repo for other `isSignedIn`, `requireUser`, `allowedEmail` and `ALLOWED_EMAIL` usages (`src/app/signin/page.tsx`, `scripts/`, `src/lib/sheets/recon.ts`) and update them to the new names. In `.env.example` replace the `ALLOWED_EMAIL` lines with:

```
# Google accounts allowed to sign in, separated by commas. The first one is the owner
# (the only person who can change Portion settings).
ALLOWED_EMAILS=owner@example.com
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: allow several Google accounts and add an owner

ALLOWED_EMAILS lists who may sign in; the first address is the owner and
the only one who can change Portion settings. ALLOWED_EMAIL still works
when ALLOWED_EMAILS is not set.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Payments Log gets "Logged by" and "Action"

**Files:**
- Modify: `src/lib/sheets/settings-store.ts`, `src/lib/sheets/service.ts`, `src/lib/server/schemas.ts`, `src/app/api/payments/route.ts`
- Test: `tests/sheets/settings-store.test.ts`, `tests/sheets/service.test.ts`, `tests/sheets/final-wave.test.ts` (and any other test that calls `logPayment`)

**Interfaces:**
- Produces (`service.ts`): `type LogAction = "Logged" | "Edited" | "Undone"`; `type LogRow = [string, string, string, string, number, number, string, string, LogAction]` (saved at, month, portion, tenant, amount, count, date received, logged by, action); `LogPaymentOptions = { now: Date; loggedBy: string; retryDelayMs?: number }`.
- Produces (`settings-store.ts`): `LOG_HEADERS` with nine entries; `ensureTabs` upgrades an older Payments Log header row once.
- Consumes: `requireUser(): Promise<Viewer>` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `tests/sheets/settings-store.test.ts` add (use the existing imports and helpers of that file; add `LOG_HEADERS` if needed):

```ts
describe("ensureTabs: Payments Log header upgrade", () => {
  const oldHeaders = ["Saved at", "Month", "Portion", "Tenant", "Amount", "Count", "Date received"];
  const row = ["2026-09-05T00:00:00.000Z", "2026-09", "First floor, single bedroom", "Asha", 5450, 3, "2026-09-05"];

  async function run(logRows: unknown[][]) {
    const fake = new FakeGateway({ Schedule: baseSchedule(), Settings: [[...SETTINGS_HEADERS]], [LOG_TAB]: logRows });
    await ensureTabs(fake, "Schedule");
    return fake;
  }

  it("adds Logged by and Action to an old header row and leaves data rows alone", async () => {
    const fake = await run([oldHeaders, row]);
    expect(fake.tabs.get(LOG_TAB)![0]).toEqual(LOG_HEADERS);
    expect(fake.tabs.get(LOG_TAB)![1]).toEqual(row);
  });

  it("writes nothing when the headers are already current", async () => {
    const fake = await run([[...LOG_HEADERS]]);
    const writesBefore = fake.calls.filter((c) => c === "updateValues").length;
    expect(writesBefore).toBe(0);
  });

  it("writes the whole header row into an empty Payments Log tab", async () => {
    const fake = await run([]);
    expect(fake.tabs.get(LOG_TAB)![0]).toEqual(LOG_HEADERS);
  });
});
```

(`ensureTabs` skips Settings creation because a `Settings` tab exists. If `SETTINGS_HEADERS`, `baseSchedule`, `FakeGateway` or `ensureTabs` are not yet imported in that test file, import them.)

In `tests/sheets/service.test.ts`: change the `pay` helper to pass the new option, and update the log expectations:

```ts
const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "owner@example.com" };

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string }) =>
  logPayment(ctx, { month: OCT, amount: 5450, dateReceived: "2026-10-05", ...input }, OPTIONS);
```

Change the "writes a Payments Log row with the date received" expectation to nine values ending `"owner@example.com", "Logged"`, and add:

```ts
  it("records Edited when an existing amount is replaced", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    await pay(ctx, { portionId: "p1", amount: 6000, overwrite: true });
    const log = fake.tabs.get(LOG_TAB)!;
    const last = log[log.length - 1];
    expect(last[7]).toBe("owner@example.com");
    expect(last[8]).toBe("Edited");
  });
```

Update every other direct call of `logPayment(` in `tests/` (grep for it, including `tests/sheets/final-wave.test.ts`) to include `loggedBy` in the options argument.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/sheets`
Expected: FAIL (types and header expectations).

- [ ] **Step 3: Implement**

`settings-store.ts`: replace `LOG_HEADERS` with:

```ts
export const LOG_HEADERS = [
  "Saved at",
  "Month",
  "Portion",
  "Tenant",
  "Amount",
  "Count",
  "Date received",
  "Logged by",
  "Action",
];
```

In `ensureTabs`, replace the `if (!tabs.includes(LOG_TAB)) { ... }` block with:

```ts
  if (!tabs.includes(LOG_TAB)) {
    await gateway.addTab(LOG_TAB);
    await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
  } else {
    // An older Payments Log has only the first seven columns. Add the two new headers once.
    const header = (await gateway.getValues(LOG_TAB, "A1:I1", "FORMATTED_VALUE"))[0] ?? [];
    if (header.length === 0) {
      await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
    } else if (header[7] !== LOG_HEADERS[7] || header[8] !== LOG_HEADERS[8]) {
      await gateway.updateValues([{ tab: LOG_TAB, a1: "H1:I1", values: [LOG_HEADERS.slice(7)] }]);
    }
  }
```

`service.ts`: replace the `LogRow` type and the `LogPaymentOptions` type, and update `logPayment`:

```ts
export type LogAction = "Logged" | "Edited" | "Undone";

/** Saved at, month, portion, tenant, amount, count, date received, logged by, action. */
export type LogRow = [string, string, string, string, number, number, string, string, LogAction];

export type LogPaymentOptions = {
  now: Date;
  /** Email of the signed-in person. */
  loggedBy: string;
  retryDelayMs?: number;
};
```

In `logPayment`, replace the `logRow` construction with:

```ts
  const action: LogAction = existing ? "Edited" : "Logged";
  const logRow: LogRow = [
    options.now.toISOString(),
    ymKey(input.month),
    portion.name,
    tenant,
    input.amount,
    count,
    input.dateReceived,
    options.loggedBy,
    action,
  ];
```

`schemas.ts`: replace `logRetryBody` with:

```ts
export const logRetryBody = z.object({
  row: z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.number(),
    z.number(),
    z.string(),
    z.string(),
    z.enum(["Logged", "Edited", "Undone"]),
  ]),
});
```

`src/app/api/payments/route.ts`: use the viewer:

```ts
    const viewer = await requireUser();
    ...
      { now: new Date(), loggedBy: viewer.email },
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: record who logged a payment and what happened to it

Payments Log gains Logged by and Action columns. Older logs get the two
headers added once; existing rows are untouched.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Undo (domain, service, route)

**Files:**
- Modify: `src/lib/domain/types.ts`, `src/lib/domain/month-view.ts`, `src/lib/sheets/service.ts`, `src/lib/server/schemas.ts`
- Create: `src/app/api/payments/undo/route.ts`
- Test: `tests/domain/month-view.test.ts`, `tests/sheets/undo.test.ts` (new), `tests/server/routes.test.ts`

**Interfaces:**
- Consumes: `LogRow`, `LogAction`, `LogPaymentOptions` (Task 2), `requireUser` (Task 1).
- Produces (`month-view.ts`): `LATER_ENTRY_REASON: string`; `hasLaterEntry(rows: ScheduleRow[], portionId: string, month: YearMonth): boolean`. `PortionCard` gains `undoBlockedReason: string | null` (non-null only for a paid card that cannot be undone).
- Produces (`service.ts`): `type UndoPaymentInput = { month: YearMonth; portionId: string; expected: PortionEntry }`, `type UndoPaymentResult = { removed: PortionEntry; logWritten: boolean; logRow: LogRow }`, `undoPayment(ctx: SheetsContext, input: UndoPaymentInput, options: LogPaymentOptions): Promise<UndoPaymentResult>`.
- Produces (`schemas.ts`): `undoBody`.
- Produces (HTTP): `POST /api/payments/undo` with body `{ month, portionId, expected: { tenant, count, amount } }`; success `{ ok: true, removed, logWritten, logRow }`.

- [ ] **Step 1: Write the failing domain tests**

Append to `tests/domain/month-view.test.ts` (reuse the file's existing imports and fixtures; `baseRows`, `portions` stand for whatever that file already builds, and the example below builds its own rows so it is self-contained):

```ts
import { hasLaterEntry, LATER_ENTRY_REASON } from "@/lib/domain/month-view";

describe("undoBlockedReason", () => {
  const portions = PORTIONS.slice(0, 1);
  const entry = { tenant: "Asha", count: 1, amount: 5000 };
  const rowFor = (month: number, e: typeof entry | null, rowNumber: number) => ({
    rowNumber,
    month: { year: 2026, month },
    entries: { p1: e },
  });

  it("is null when the paid month is the portion's latest entry", () => {
    const rows = [rowFor(9, entry, 4), rowFor(10, entry, 5)];
    const view = deriveMonthView(rows, portions, { year: 2026, month: 10 });
    expect(view.cards[0].status).toBe("paid");
    expect(view.cards[0].undoBlockedReason).toBeNull();
  });

  it("explains why when a later month has an entry", () => {
    const rows = [rowFor(9, entry, 4), rowFor(10, entry, 5)];
    const view = deriveMonthView(rows, portions, { year: 2026, month: 9 });
    expect(view.cards[0].undoBlockedReason).toBe(LATER_ENTRY_REASON);
  });

  it("is null for a card that is not paid", () => {
    const rows = [rowFor(9, entry, 4)];
    const view = deriveMonthView(rows, portions, { year: 2026, month: 10 });
    expect(view.cards[0].status).toBe("pending");
    expect(view.cards[0].undoBlockedReason).toBeNull();
  });

  it("hasLaterEntry ignores earlier months and empty later rows", () => {
    const rows = [rowFor(8, entry, 3), rowFor(9, entry, 4), rowFor(10, null, 5)];
    expect(hasLaterEntry(rows, "p1", { year: 2026, month: 9 })).toBe(false);
    expect(hasLaterEntry(rows, "p1", { year: 2026, month: 8 })).toBe(true);
  });
});
```

Import `PORTIONS` from `../support/fixtures` and `deriveMonthView` if the file does not already.

- [ ] **Step 2: Write the failing service tests**

Create `tests/sheets/undo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  getMonthView,
  logPayment,
  undoPayment,
  type LogPaymentInput,
  type SheetsContext,
} from "@/lib/sheets/service";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };
const NOV = { year: 2026, month: 11 };
const OPTIONS = { now: NOW, retryDelayMs: 0, loggedBy: "member@example.com" };

function setup(schedule: unknown[][] = baseSchedule()) {
  const fake = new FakeGateway({ Schedule: schedule });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string }) =>
  logPayment(ctx, { month: OCT, amount: 5450, dateReceived: "2026-10-05", ...input }, OPTIONS);

async function code(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

const blank = (value: unknown) => value === undefined || value === "";

describe("undoPayment", () => {
  it("clears the portion's cells, keeps a formula total, and logs Undone", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });

    const result = await undoPayment(
      ctx,
      { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
      OPTIONS,
    );

    expect(result).toMatchObject({ removed: { tenant: "Asha", count: 4, amount: 5450 }, logWritten: true });
    expect(blank(cell(fake, "Schedule", "B", 6))).toBe(true);
    expect(blank(cell(fake, "Schedule", "C", 6))).toBe(true);
    expect(blank(cell(fake, "Schedule", "D", 6))).toBe(true);
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");

    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1]).toEqual([
      "2026-10-05T04:30:00.000Z",
      "2026-10",
      "First floor, single bedroom",
      "Asha",
      5450,
      4,
      "",
      "member@example.com",
      "Undone",
    ]);
  });

  it("rewrites a typed total without the undone amount", async () => {
    const schedule = baseSchedule();
    schedule[3][16] = 18150;
    schedule[4][16] = 27250;
    const { fake, ctx } = setup(schedule);
    await pay(ctx, { portionId: "p1" });
    await pay(ctx, { portionId: "p2", amount: 13300 });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(18750);

    await undoPayment(
      ctx,
      { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
      OPTIONS,
    );
    expect(cell(fake, "Schedule", "Q", 6)).toBe(13300);
  });

  it("refuses when the stored entry differs from what the person saw", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const before = structuredClone(fake.tabs.get("Schedule"));
    const failure = await code(
      undoPayment(
        ctx,
        { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 9999 } },
        OPTIONS,
      ),
    );
    expect(failure).toBe("conflict");
    expect(fake.tabs.get("Schedule")).toEqual(before);
  });

  it("refuses when there is nothing to undo", async () => {
    const { ctx } = setup();
    const failure = await code(
      undoPayment(
        ctx,
        { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
        OPTIONS,
      ),
    );
    expect(failure).toBe("conflict");
  });

  it("refuses to undo a month when a later month has an entry", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    await logPayment(ctx, { month: NOV, portionId: "p1", amount: 5450, dateReceived: "2026-11-05" }, OPTIONS);
    const before = structuredClone(fake.tabs.get("Schedule"));
    const failure = await code(
      undoPayment(
        ctx,
        { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
        OPTIONS,
      ),
    );
    expect(failure).toBe("conflict");
    expect(fake.tabs.get("Schedule")).toEqual(before);
  });

  it("undoes a new tenant's first payment and returns the portion to its earlier state", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p4", newTenantName: "Dev", amount: 7000 });
    await undoPayment(
      ctx,
      { month: OCT, portionId: "p4", expected: { tenant: "Dev", count: 1, amount: 7000 } },
      OPTIONS,
    );
    expect((await getMonthView(ctx, OCT)).cards[3].status).toBe("needs-tenant");
  });

  it("keeps the cleared cells when only the log write fails", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    fake.failOn.add("appendRow");
    const result = await undoPayment(
      ctx,
      { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } },
      OPTIONS,
    );
    expect(result.logWritten).toBe(false);
    expect(blank(cell(fake, "Schedule", "D", 6))).toBe(true);
  });
});
```

Append to `tests/server/routes.test.ts`: mock `undoPayment` in the `vi.mock("@/lib/sheets/service", ...)` factory (add `undoPayment` to the hoisted mocks), import `POST as postUndo` from `@/app/api/payments/undo/route`, and add:

```ts
describe("POST /api/payments/undo", () => {
  const undoRequest = (body: unknown) =>
    new Request("http://localhost/api/payments/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const good = {
    month: "2026-10",
    portionId: "p1",
    expected: { tenant: "Asha", count: 4, amount: 5450 },
  };

  it("rejects visitors who are not on the list", async () => {
    signedInAs("stranger@example.com");
    expect((await postUndo(undoRequest(good))).status).toBe(401);
    expect(undoPayment).not.toHaveBeenCalled();
  });

  it("lets any listed member undo and records who did it", async () => {
    signedInAs("member@example.com");
    undoPayment.mockResolvedValue({ removed: good.expected, logWritten: true, logRow: [] });
    const res = await postUndo(undoRequest(good));
    expect(res.status).toBe(200);
    expect(undoPayment.mock.calls[0][2]).toMatchObject({ loggedBy: "member@example.com" });
  });

  it("rejects a malformed body", async () => {
    signedInAs("member@example.com");
    expect((await postUndo(undoRequest({ month: "nope" }))).status).toBe(400);
  });
});
```

(`undoPayment` is declared with `const undoPayment = vi.hoisted(() => vi.fn());` next to `saveSettings` and added to the mock factory.)

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run tests/domain tests/sheets/undo.test.ts tests/server`
Expected: FAIL (missing exports and route).

- [ ] **Step 4: Implement the domain part**

`types.ts`: add to `PortionCard`:

```ts
  /** For a paid card that cannot be undone, the reason. Null otherwise. */
  undoBlockedReason: string | null;
```

`month-view.ts`: add

```ts
export const LATER_ENTRY_REASON =
  "Later months have entries for this portion. Undo those first.";

/** True when a month after `month` has an entry for the portion. */
export function hasLaterEntry(
  rows: ScheduleRow[],
  portionId: string,
  month: YearMonth,
): boolean {
  return rows.some((row) => compareYm(row.month, month) > 0 && row.entries[portionId]);
}
```

and in `deriveMonthView`, in the card object add:

```ts
      undoBlockedReason:
        entry && hasLaterEntry(rows, portion.id, month) ? LATER_ENTRY_REASON : null,
```

Fix any existing test or component that builds a `PortionCard` literal (add `undoBlockedReason: null`).

- [ ] **Step 5: Implement the service and the route**

In `service.ts` add the import `hasLaterEntry, LATER_ENTRY_REASON` from `@/lib/domain/month-view`, then add after `logPayment`:

```ts
export type UndoPaymentInput = {
  month: YearMonth;
  portionId: string;
  /** What the person saw on screen. The undo is refused if the Sheet no longer matches. */
  expected: PortionEntry;
};

export type UndoPaymentResult = {
  removed: PortionEntry;
  logWritten: boolean;
  logRow: LogRow;
};

/**
 * Clears one portion's tenant, count and amount for a month. Only the portion's
 * latest entry can be undone, and only if the Sheet still matches `expected`.
 */
export async function undoPayment(
  ctx: SheetsContext,
  input: UndoPaymentInput,
  options: LogPaymentOptions,
): Promise<UndoPaymentResult> {
  validateMonth(input.month);
  const loaded = await load(ctx);
  const portion = loaded.portions.find((p) => p.id === input.portionId);
  if (!portion) throw validation(`Unknown portion "${input.portionId}".`);

  const matching = loaded.rows.filter(
    (row) => compareYm(row.month, input.month) === 0 && row.entries[portion.id],
  );
  const monthRow = matching[matching.length - 1];
  const existing = monthRow?.entries[portion.id];
  if (!monthRow || !existing) {
    throw conflict(
      `${portion.name} has no payment recorded for ${ymKey(input.month)} any more. Refresh the page.`,
    );
  }
  const { tenant, count, amount } = input.expected;
  if (existing.tenant !== tenant || existing.count !== count || existing.amount !== amount) {
    throw conflict(
      `${portion.name} for ${ymKey(input.month)} was changed by someone else. Refresh the page and try again.`,
    );
  }
  if (hasLaterEntry(loaded.rows, portion.id, input.month)) {
    throw conflict(LATER_ENTRY_REASON);
  }

  const cols = loaded.layout.portionCols[portion.id];
  const at = (col: number) => `${colLetter(col)}${monthRow.rowNumber}`;
  const writes = [
    { tab: ctx.scheduleTab, a1: at(cols.tenant), values: [[""]] },
    { tab: ctx.scheduleTab, a1: at(cols.count), values: [[""]] },
    { tab: ctx.scheduleTab, a1: at(cols.amount), values: [[""]] },
  ];
  if (!(await totalIsFormula(ctx, loaded.layout, monthRow.rowNumber))) {
    const others = loaded.portions
      .filter((p) => p.id !== portion.id)
      .map((p) => monthRow.entries[p.id]?.amount);
    writes.push({
      tab: ctx.scheduleTab,
      a1: at(loaded.layout.totalCol),
      values: [[sumAmounts(others)]],
    });
  }
  await ctx.gateway.updateValues(writes);

  const logRow: LogRow = [
    options.now.toISOString(),
    ymKey(input.month),
    portion.name,
    existing.tenant,
    existing.amount,
    existing.count,
    "",
    options.loggedBy,
    "Undone",
  ];
  const logWritten = await appendLogRow(ctx.gateway, logRow, options.retryDelayMs ?? 400);
  return { removed: existing, logWritten, logRow };
}
```

Extract the month check from `validateInput` into a shared function so both use it. In `service.ts` replace the first `if (...) { throw validation("Month must be a real month."); }` block of `validateInput` with a call to a new function:

```ts
function validateMonth({ year, month }: YearMonth): void {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw validation("Month must be a real month.");
  }
}
```

and `validateInput` starts with `validateMonth(input.month);`.

Before relying on `""` to clear a cell, open `src/lib/sheets/google-gateway.ts` and confirm `updateValues` sends the value through unchanged with `valueInputOption: "RAW"`. An empty string clears a cell in the Sheets API. If the gateway filters or rewrites empty strings, fix that there and add a test in `tests/sheets/google-gateway.test.ts`.

`schemas.ts`: add

```ts
const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-10");

export const undoBody = z.object({
  month: monthString,
  portionId: z.string().min(1).max(20),
  expected: z.object({ tenant: z.string(), count: z.number(), amount: z.number() }),
});
```

and make `paymentBody.month` use `monthString`.

Create `src/app/api/payments/undo/route.ts`:

```ts
import { parseYmKey } from "@/lib/domain/year-month";
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { undoBody } from "@/lib/server/schemas";
import { undoPayment } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await requireUser();
    const body = await parseJson(request, undoBody);
    const result = await undoPayment(
      getSheetsContext(),
      { month: parseYmKey(body.month)!, portionId: body.portionId, expected: body.expected },
      { now: new Date(), loggedBy: viewer.email },
    );
    return { ...result };
  });
}
```

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: undo a logged payment

Clears a portion's tenant, count and amount for its latest entry, refuses
when the Sheet changed since the person looked, and logs an Undone row.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Activity screen

**Files:**
- Modify: `src/lib/sheets/service.ts`, `src/lib/format.ts`
- Create: `src/app/activity/page.tsx`
- Test: `tests/sheets/activity.test.ts` (new), `tests/domain/format.test.ts`

**Interfaces:**
- Consumes: `LogAction`, `LOG_TAB`, `ensureTabs`.
- Produces (`service.ts`): `type ActivityItem = { savedAt: string; month: string; portion: string; tenant: string; amount: number | null; count: number | null; dateReceived: string; loggedBy: string; action: LogAction }`; `readActivity(ctx: SheetsContext, limit?: number): Promise<ActivityItem[]>` (newest first, default limit 50).
- Produces (`format.ts`): `formatSavedAt(iso: string): string` (India time, for example `6 Oct, 4:30 pm`; returns the input unchanged if it is not a valid date).

- [ ] **Step 1: Write the failing tests**

Create `tests/sheets/activity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readActivity, type SheetsContext } from "@/lib/sheets/service";
import { LOG_HEADERS, LOG_TAB } from "@/lib/sheets/settings-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

function setup(logRows: unknown[][]) {
  const fake = new FakeGateway({ Schedule: baseSchedule(), [LOG_TAB]: [[...LOG_HEADERS], ...logRows] });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const row = (n: number, extra: unknown[] = ["owner@example.com", "Logged"]) => [
  `2026-10-0${n}T04:30:00.000Z`, "2026-10", "First floor, single bedroom", "Asha", 5450, n, `2026-10-0${n}`, ...extra,
];

describe("readActivity", () => {
  it("returns the newest rows first", async () => {
    const { ctx } = setup([row(1), row(2), row(3)]);
    const items = await readActivity(ctx);
    expect(items.map((i) => i.count)).toEqual([3, 2, 1]);
    expect(items[0]).toEqual({
      savedAt: "2026-10-03T04:30:00.000Z",
      month: "2026-10",
      portion: "First floor, single bedroom",
      tenant: "Asha",
      amount: 5450,
      count: 3,
      dateReceived: "2026-10-03",
      loggedBy: "owner@example.com",
      action: "Logged",
    });
  });

  it("limits the number of rows", async () => {
    const { ctx } = setup(Array.from({ length: 7 }, (_, i) => row(i + 1)));
    expect(await readActivity(ctx, 3)).toHaveLength(3);
  });

  it("treats rows from before the new columns as Logged by nobody", async () => {
    const { ctx } = setup([row(1, [])]);
    const [item] = await readActivity(ctx);
    expect(item.loggedBy).toBe("");
    expect(item.action).toBe("Logged");
  });

  it("keeps Edited and Undone actions and ignores blank rows", async () => {
    const { ctx } = setup([row(1, ["a@example.com", "Edited"]), [], row(2, ["b@example.com", "Undone"])]);
    const items = await readActivity(ctx);
    expect(items.map((i) => i.action)).toEqual(["Undone", "Edited"]);
  });

  it("returns an empty list for an empty log", async () => {
    const { ctx } = setup([]);
    expect(await readActivity(ctx)).toEqual([]);
  });
});
```

Add to `tests/domain/format.test.ts`:

```ts
describe("formatSavedAt", () => {
  it("shows India time", () => {
    expect(formatSavedAt("2026-10-05T04:30:00.000Z")).toMatch(/5 Oct.*10:00\s?am/i);
  });
  it("returns text that is not a date unchanged", () => {
    expect(formatSavedAt("not a date")).toBe("not a date");
  });
});
```

(import `formatSavedAt` from `@/lib/format`.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/sheets/activity.test.ts tests/domain/format.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`format.ts`: add

```ts
const savedAt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** "2026-10-05T04:30:00.000Z" -> "5 Oct, 10:00 am" (India time). */
export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : savedAt.format(date);
}
```

`service.ts`: add

```ts
export type ActivityItem = {
  savedAt: string;
  month: string;
  portion: string;
  tenant: string;
  amount: number | null;
  count: number | null;
  dateReceived: string;
  loggedBy: string;
  action: LogAction;
};

const ACTIONS: readonly LogAction[] = ["Logged", "Edited", "Undone"];

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));
const num = (value: unknown) => (typeof value === "number" ? value : null);

/** The latest Payments Log rows, newest first. Rows from before "Logged by" and "Action" existed read as Logged by nobody. */
export async function readActivity(ctx: SheetsContext, limit = 50): Promise<ActivityItem[]> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  const values = await ctx.gateway.getValues(LOG_TAB, "A1:I", "UNFORMATTED_VALUE");
  const items = values
    .slice(1)
    .filter((row) => row.some((cell) => cell !== undefined && cell !== ""))
    .map((row): ActivityItem => {
      const action = ACTIONS.find((candidate) => candidate === row[8]) ?? "Logged";
      return {
        savedAt: text(row[0]),
        month: text(row[1]),
        portion: text(row[2]),
        tenant: text(row[3]),
        amount: num(row[4]),
        count: num(row[5]),
        dateReceived: text(row[6]),
        loggedBy: text(row[7]),
        action,
      };
    });
  return items.reverse().slice(0, limit);
}
```

Import `LOG_TAB` is already imported in `service.ts`.

Create `src/app/activity/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { formatRupees, formatSavedAt } from "@/lib/format";
import { getViewer } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { readActivity, type ActivityItem } from "@/lib/sheets/service";

const PILL = {
  Logged: "bg-success-bg text-success-ink",
  Edited: "bg-warn-bg text-warn-ink",
  Undone: "bg-danger-bg text-danger-ink",
} as const;

export default async function ActivityPage() {
  if (!(await getViewer())) redirect("/signin");

  let items: ActivityItem[] | null = null;
  let problem: string | null = null;
  try {
    items = await readActivity(getSheetsContext());
  } catch (error) {
    if (error instanceof AppError) {
      problem = error.message;
    } else {
      console.error(error);
      problem = "Couldn't reach Google Sheets. Try again.";
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
      <nav className="flex items-center gap-2">
        <Link href="/" aria-label="Back to month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">Activity</h1>
      </nav>

      {problem && (
        <p role="alert" className="mt-4 rounded-2xl bg-danger-bg p-4 text-sm text-danger-ink">
          {problem}
        </p>
      )}

      {items && items.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">Nothing has been logged yet.</p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-3 space-y-3">
          {items.map((item, index) => (
            <li key={`${item.savedAt}-${index}`} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.portion}</p>
                <span className={`shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium ${PILL[item.action]}`}>
                  {item.action}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {item.tenant}
                {item.count !== null ? ` · Payment ${item.count}` : ""} · {item.month}
              </p>
              {item.amount !== null && <p className="mt-1 text-lg font-medium">{formatRupees(item.amount)}</p>}
              <p className="mt-1 text-sm text-muted">
                {formatSavedAt(item.savedAt)} · {item.loggedBy || "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

(The Activity link goes into the home footer in Task 7.)

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add an Activity screen of the latest Payments Log rows

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Faster loads (parallel reads, snapshot cache, read-your-writes)

**Files:**
- Create: `src/lib/sheets/snapshot-cache.ts`, `src/lib/server/freshness.ts`
- Modify: `src/lib/sheets/service.ts`, `src/lib/server/context.ts`, `src/app/page.tsx`, `src/app/api/payments/route.ts`, `src/app/api/payments/undo/route.ts`, `src/app/api/settings/route.ts`
- Test: `tests/sheets/snapshot-cache.test.ts`, `tests/sheets/cache.test.ts`, `tests/server/freshness.test.ts`, `tests/server/routes.test.ts`

**Interfaces:**
- Produces (`snapshot-cache.ts`): `type SnapshotCache<T> = { get(minFetchedAt?: number): Promise<T>; invalidate(): void }`; `createSnapshotCache<T>(load: () => Promise<T>, ttlMs: number, now?: () => number): SnapshotCache<T>`.
- Produces (`service.ts`): `SheetsContext` gains optional `cache?: SnapshotCache<Snapshot>`; `type Snapshot = { portions: PortionConfig[]; layout: ScheduleLayout; rows: ScheduleRow[] }`; `withSnapshotCache(ctx: SheetsContext, ttlMs?: number): SheetsContext`; `getMonthView(ctx, month, options?: { minFetchedAt?: number })`.
- Produces (`freshness.ts`): `markWritten(now?: number): Promise<void>`, `readWrittenAt(): Promise<number | undefined>`.

- [ ] **Step 1: Read the docs**

Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` and confirm: `cookies()` is async, and `cookies().set(...)` works in a Route Handler. Note the exact option names (`httpOnly`, `secure`, `sameSite`, `path`, `maxAge`). This plan deliberately does not use `unstable_cache` (replaced by `use cache`) or Cache Components, which would change how every page renders.

- [ ] **Step 2: Write the failing cache tests**

Create `tests/sheets/snapshot-cache.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createSnapshotCache } from "@/lib/sheets/snapshot-cache";

function setup(ttlMs = 15_000) {
  let clock = 1_000;
  let calls = 0;
  const load = vi.fn(async () => ({ n: ++calls }));
  const cache = createSnapshotCache(load, ttlMs, () => clock);
  return { cache, load, advance: (ms: number) => (clock += ms), set: (t: number) => (clock = t) };
}

describe("createSnapshotCache", () => {
  it("serves the cached value inside the lifetime and reloads after it", async () => {
    const { cache, load, advance } = setup();
    expect((await cache.get()).n).toBe(1);
    advance(14_999);
    expect((await cache.get()).n).toBe(1);
    advance(2);
    expect((await cache.get()).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent callers", async () => {
    const { cache, load } = setup();
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads when the data is older than the caller's minimum freshness", async () => {
    const { cache, load, advance, set } = setup();
    await cache.get();
    advance(1_000);
    const wroteAt = 2_000;
    set(2_500);
    expect((await cache.get(wroteAt)).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect((await cache.get(wroteAt)).n).toBe(2);
  });

  it("invalidate drops the value and any load already in flight", async () => {
    const { cache, load } = setup();
    const first = cache.get();
    cache.invalidate();
    await first;
    expect((await cache.get()).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed load", async () => {
    let fail = true;
    const cache = createSnapshotCache(async () => {
      if (fail) throw new Error("boom");
      return "ok";
    }, 15_000, () => 1);
    await expect(cache.get()).rejects.toThrow("boom");
    fail = false;
    expect(await cache.get()).toBe("ok");
  });
});
```

Create `tests/sheets/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getMonthView,
  logPayment,
  saveSettings,
  undoPayment,
  withSnapshotCache,
  type SheetsContext,
} from "@/lib/sheets/service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const OCT = { year: 2026, month: 10 };
const OPTIONS = { now: new Date("2026-10-05T04:30:00Z"), retryDelayMs: 0, loggedBy: "owner@example.com" };

function setup() {
  const fake = new FakeGateway({ Schedule: baseSchedule() });
  const ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext);
  const reads = () => fake.calls.filter((c) => c === "getValues").length;
  return { fake, ctx, reads };
}

describe("cached month views", () => {
  it("reads the Sheet once for repeated views of any month", async () => {
    const { ctx, reads } = setup();
    await getMonthView(ctx, OCT);
    const afterFirst = reads();
    await getMonthView(ctx, { year: 2026, month: 9 });
    await getMonthView(ctx, { year: 2026, month: 11 });
    expect(reads()).toBe(afterFirst);
  });

  it("shows a payment straight away after logging it", async () => {
    const { ctx } = setup();
    await getMonthView(ctx, OCT);
    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("paid");
  });

  it("shows an undo straight away", async () => {
    const { ctx } = setup();
    await logPayment(ctx, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("paid");
    await undoPayment(ctx, { month: OCT, portionId: "p1", expected: { tenant: "Asha", count: 4, amount: 5450 } }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");
  });

  it("shows new settings straight away", async () => {
    const { ctx } = setup();
    await getMonthView(ctx, OCT);
    await saveSettings(ctx, [{ id: "p1", name: "Renamed", cycleLength: 11, hikePercent: 5 }]);
    expect((await getMonthView(ctx, OCT)).cards[0].name).toBe("Renamed");
  });

  it("writes never use a stale snapshot", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    // Someone else logs through a second context sharing the same Sheet.
    const other = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext;
    await logPayment(other, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    await expect(
      logPayment(ctx, { month: OCT, portionId: "p1", amount: 1, dateReceived: "2026-10-05" }, OPTIONS),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("a caller can demand data newer than a given time", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    const other = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext;
    await logPayment(other, { month: OCT, portionId: "p1", amount: 5450, dateReceived: "2026-10-05" }, OPTIONS);
    expect((await getMonthView(ctx, OCT)).cards[0].status).toBe("pending");
    expect((await getMonthView(ctx, OCT, { minFetchedAt: Date.now() + 1 })).cards[0].status).toBe("paid");
  });
});
```

Create `tests/server/freshness.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn((name: string, value: string) => void store.set(name, value)),
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { markWritten, readWrittenAt } from "@/lib/server/freshness";

beforeEach(() => jar.store.clear());

describe("freshness cookie", () => {
  it("round-trips the write time", async () => {
    await markWritten(123_456);
    expect(await readWrittenAt()).toBe(123_456);
  });

  it("returns undefined when absent or not a number", async () => {
    expect(await readWrittenAt()).toBeUndefined();
    jar.store.set("rb-wrote", "abc");
    expect(await readWrittenAt()).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/sheets/snapshot-cache.test.ts tests/sheets/cache.test.ts tests/server/freshness.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

Create `src/lib/sheets/snapshot-cache.ts`:

```ts
export type SnapshotCache<T> = {
  /** `minFetchedAt` (ms since epoch) rejects any value whose load began before that time. */
  get(minFetchedAt?: number): Promise<T>;
  invalidate(): void;
};

export function createSnapshotCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): SnapshotCache<T> {
  let entry: { value: T; startedAt: number } | null = null;
  let inflight: { promise: Promise<T>; startedAt: number } | null = null;
  let generation = 0;

  return {
    async get(minFetchedAt = 0) {
      const t = now();
      if (entry && t - entry.startedAt < ttlMs && entry.startedAt >= minFetchedAt) return entry.value;
      if (inflight && inflight.startedAt >= minFetchedAt) return inflight.promise;

      const startedAt = t;
      const startedGeneration = generation;
      const promise: Promise<T> = load()
        .then((value) => {
          if (startedGeneration === generation) entry = { value, startedAt };
          return value;
        })
        .finally(() => {
          if (inflight?.promise === promise) inflight = null;
        });
      inflight = { promise, startedAt };
      return promise;
    },
    invalidate() {
      generation += 1;
      entry = null;
      inflight = null;
    },
  };
}
```

Create `src/lib/server/freshness.ts`:

```ts
import { cookies } from "next/headers";

const COOKIE = "rb-wrote";

/** Remember, in this person's browser, when they last changed the Sheet. */
export async function markWritten(now = Date.now()): Promise<void> {
  (await cookies()).set(COOKIE, String(now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 120,
  });
}

/** When this person last changed the Sheet, if they did in the last two minutes. */
export async function readWrittenAt(): Promise<number | undefined> {
  const value = Number((await cookies()).get(COOKIE)?.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
```

`service.ts`: apply these edits.

```ts
import { createSnapshotCache, type SnapshotCache } from "./snapshot-cache";

export type Snapshot = {
  portions: PortionConfig[];
  layout: ScheduleLayout;
  rows: ScheduleRow[];
};

export type SheetsContext = {
  gateway: SheetsGateway;
  scheduleTab: string;
  totalHeader: string;
  /** Short-lived copy of the Settings and Schedule reads. Page views use it; writes never do. */
  cache?: SnapshotCache<Snapshot>;
};
```

Replace the old `Loaded` type with `Snapshot` (rename every use of `Loaded`). Replace `load` with:

```ts
async function load(ctx: SheetsContext): Promise<Snapshot> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  const [portions, values] = await Promise.all([
    readSettings(ctx.gateway),
    ctx.gateway.getValues(ctx.scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE"),
  ]);
  return { portions, ...parseSchedule(values, portions, ctx.totalHeader) };
}

export const SNAPSHOT_TTL_MS = 15_000;

/** Adds the page-view cache to a context. */
export function withSnapshotCache(ctx: SheetsContext, ttlMs = SNAPSHOT_TTL_MS): SheetsContext {
  ctx.cache = createSnapshotCache(() => load(ctx), ttlMs);
  return ctx;
}
```

Replace `getMonthView` with:

```ts
export async function getMonthView(
  ctx: SheetsContext,
  month: YearMonth,
  options: { minFetchedAt?: number } = {},
): Promise<MonthView> {
  const { portions, rows } = ctx.cache ? await ctx.cache.get(options.minFetchedAt) : await load(ctx);
  return deriveMonthView(rows, portions, month);
}
```

Wrap the write sections so the cache is always cleared, even after a failure part-way. In `logPayment` and `undoPayment`, after the validation and conflict checks and immediately before the first `ctx.gateway` write (`ensureMonthRow`/`updateValues`), do not restructure the code. Instead rename the existing exported functions to private `logPaymentUnchecked` and `undoPaymentUnchecked` and export thin wrappers:

```ts
export async function logPayment(
  ctx: SheetsContext,
  input: LogPaymentInput,
  options: LogPaymentOptions,
): Promise<LogPaymentResult> {
  try {
    return await logPaymentUnchecked(ctx, input, options);
  } finally {
    ctx.cache?.invalidate();
  }
}

export async function undoPayment(
  ctx: SheetsContext,
  input: UndoPaymentInput,
  options: LogPaymentOptions,
): Promise<UndoPaymentResult> {
  try {
    return await undoPaymentUnchecked(ctx, input, options);
  } finally {
    ctx.cache?.invalidate();
  }
}
```

and in `saveSettings`:

```ts
  try {
    await ensureTabs(ctx.gateway, ctx.scheduleTab);
    await updateSettings(ctx.gateway, updates);
    return await readSettings(ctx.gateway);
  } finally {
    ctx.cache?.invalidate();
  }
```

`context.ts`: build the context with the cache:

```ts
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
...
    cached = withSnapshotCache({
      gateway: GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId),
      scheduleTab: env.scheduleTab,
      totalHeader: env.totalHeader,
    });
```

`src/app/page.tsx`: import `readWrittenAt` from `@/lib/server/freshness` and change the read to:

```ts
    const writtenAt = await readWrittenAt();
    view = await getMonthView(getSheetsContext(), month, { minFetchedAt: writtenAt });
```

Routes: in `src/app/api/payments/route.ts`, `src/app/api/payments/undo/route.ts` and `src/app/api/settings/route.ts`, import `markWritten` and call `await markWritten();` after the service call succeeds and before returning. Do not call it in `log-retry`.

In `tests/server/routes.test.ts` add `vi.mock("@/lib/server/freshness", () => ({ markWritten: vi.fn(async () => undefined), readWrittenAt: vi.fn(async () => undefined) }));` near the other mocks, and a test that a successful undo and a successful settings save call `markWritten` (import the mocked function with `vi.hoisted`).

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "perf: read the Sheet once per page view and cache it for 15 seconds

Settings and schedule reads run in parallel. A short per-instance cache
serves month switching; every write clears it and a cookie makes the writer
see their own change on any server instance.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Month navigation UI (instant feedback, Today, picker, swipe)

**Files:**
- Create: `src/lib/month-nav.ts`, `src/components/MonthFrame.tsx`, `src/components/MonthPicker.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/domain/month-nav.test.ts`

**Interfaces:**
- Produces (`month-nav.ts`): `type PickerCell = { key: string; label: string }`, `monthPickerCells(year: number): PickerCell[]`, `monthHref(key: string, currentKey: string): string`, `swipeDirection(dx: number, dy: number, minDistance?: number): "next" | "prev" | null`.
- Produces (`MonthFrame.tsx`): default export `MonthFrame({ monthKey, currentKey, children })`.
- Produces (`MonthPicker.tsx`): default export `MonthPicker({ shownKey, currentKey, onPick, onClose })`.

- [ ] **Step 1: Read the docs**

Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` and confirm `router.push` inside `startTransition` keeps `isPending` true until the new page has rendered. Also confirm that React 19 accepts the boolean `inert` attribute on a `div`.

- [ ] **Step 2: Write the failing tests**

Create `tests/domain/month-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { monthHref, monthPickerCells, swipeDirection } from "@/lib/month-nav";

describe("monthPickerCells", () => {
  it("lists the twelve months of a year", () => {
    const cells = monthPickerCells(2026);
    expect(cells).toHaveLength(12);
    expect(cells[0]).toEqual({ key: "2026-01", label: "Jan" });
    expect(cells[9]).toEqual({ key: "2026-10", label: "Oct" });
    expect(cells[11]).toEqual({ key: "2026-12", label: "Dec" });
  });
});

describe("monthHref", () => {
  it("links the current month to the plain home page and others with a month", () => {
    expect(monthHref("2026-10", "2026-10")).toBe("/");
    expect(monthHref("2026-11", "2026-10")).toBe("/?month=2026-11");
  });
});

describe("swipeDirection", () => {
  it("swiping left goes to the next month and right to the previous", () => {
    expect(swipeDirection(-90, 5)).toBe("next");
    expect(swipeDirection(90, -5)).toBe("prev");
  });
  it("ignores short swipes", () => {
    expect(swipeDirection(-59, 0)).toBeNull();
    expect(swipeDirection(40, 0)).toBeNull();
  });
  it("ignores mostly vertical movement", () => {
    expect(swipeDirection(-80, 70)).toBeNull();
    expect(swipeDirection(70, -80)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/domain/month-nav.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement the helpers**

Create `src/lib/month-nav.ts`:

```ts
import { monthName, ymKey } from "@/lib/domain/year-month";

export type PickerCell = { key: string; label: string };

export function monthPickerCells(year: number): PickerCell[] {
  return Array.from({ length: 12 }, (_, index) => ({
    key: ymKey({ year, month: index + 1 }),
    label: monthName(index + 1, false),
  }));
}

/** The current month lives at "/"; any other month at "/?month=YYYY-MM". */
export function monthHref(key: string, currentKey: string): string {
  return key === currentKey ? "/" : `/?month=${key}`;
}

/** Which way a finger drag means, or null when it is too short or mostly vertical. */
export function swipeDirection(
  dx: number,
  dy: number,
  minDistance = 60,
): "next" | "prev" | null {
  if (Math.abs(dx) < minDistance) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "prev";
}
```

- [ ] **Step 5: Implement the components**

Create `src/components/MonthPicker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { parseYmKey } from "@/lib/domain/year-month";
import { monthPickerCells } from "@/lib/month-nav";

type Props = {
  shownKey: string;
  currentKey: string;
  onPick: (key: string) => void;
  onClose: () => void;
};

export default function MonthPicker({ shownKey, currentKey, onPick, onClose }: Props) {
  const [year, setYear] = useState(() => parseYmKey(shownKey)!.year);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose month"
        className="w-full max-w-md rounded-t-2xl bg-surface p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold">{year}</h2>
          <button
            type="button"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
          >
            ›
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {monthPickerCells(year).map((cell) => {
            const shown = cell.key === shownKey;
            const current = cell.key === currentKey;
            return (
              <button
                key={cell.key}
                type="button"
                aria-current={shown ? "date" : undefined}
                onClick={() => onPick(cell.key)}
                className={`min-h-12 rounded-xl border px-3 font-medium ${
                  shown
                    ? "border-accent bg-accent text-accent-ink"
                    : current
                      ? "border-accent text-foreground"
                      : "border-line"
                }`}
              >
                {cell.label}
              </button>
            );
          })}
        </div>

        <button type="button" onClick={onClose} className="mt-3 min-h-11 w-full text-muted">
          Close
        </button>
      </div>
    </div>
  );
}
```

Create `src/components/MonthFrame.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode, type TouchEvent } from "react";
import { addMonths, parseYmKey, ymKey } from "@/lib/domain/year-month";
import { formatMonthTitle } from "@/lib/format";
import { monthHref, swipeDirection } from "@/lib/month-nav";
import MonthPicker from "./MonthPicker";

type Props = {
  /** The month the server rendered. */
  monthKey: string;
  /** The current calendar month (India time), for the Today pill. */
  currentKey: string;
  children: ReactNode;
};

export default function MonthFrame({ monthKey, currentKey, children }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(monthKey);
  const [pickerOpen, setPickerOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // While a navigation is loading, show the month that was asked for.
  const shownKey = pending ? target : monthKey;
  const shown = parseYmKey(shownKey)!;
  const title = formatMonthTitle(shown);

  function go(key: string) {
    setPickerOpen(false);
    setTarget(key);
    startTransition(() => {
      router.push(monthHref(key, currentKey));
    });
  }

  function onTouchStart(event: TouchEvent) {
    if ((event.target as HTMLElement).closest('[role="dialog"]')) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const direction = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
    if (direction) go(ymKey(addMonths(shown, direction === "next" ? 1 : -1)));
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <nav className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => go(ymKey(addMonths(shown, -1)))}
          className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
        >
          ‹
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-lg font-semibold">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPickerOpen(true)}
              className="min-h-11 rounded-lg px-3"
            >
              {title} <span aria-hidden="true">▾</span>
            </button>
          </h1>
          {shownKey !== currentKey && (
            <button
              type="button"
              onClick={() => go(currentKey)}
              className="-mt-1 min-h-11 rounded-full px-3 text-sm font-medium text-accent underline"
            >
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => go(ymKey(addMonths(shown, 1)))}
          className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
        >
          ›
        </button>
      </nav>

      <p role="status" className="sr-only">
        {pending ? `Loading ${title}` : ""}
      </p>

      <div
        aria-busy={pending}
        inert={pending}
        className={`transition-opacity ${pending ? "pointer-events-none animate-pulse opacity-50" : ""}`}
      >
        {children}
      </div>

      {pickerOpen && (
        <MonthPicker
          shownKey={shownKey}
          currentKey={currentKey}
          onPick={go}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
```

`src/app/page.tsx`: remove the `<nav>` block and the `prev`, `next` and `title` variables that only it used (keep `title` for the `monthLabel` prop of `PortionBoard`). Import `MonthFrame` and `currentYm`. Wrap the problem alert, the summary and the board in the frame:

```tsx
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
      <MonthFrame monthKey={ymKey(month)} currentKey={ymKey(currentYm(now))}>
        {problem && ( ...unchanged alert... )}
        {view && ( ...unchanged summary and PortionBoard... )}
      </MonthFrame>

      <footer ...unchanged...>
```

The "Try again" link in the alert keeps `href={`/?month=${ymKey(month)}`}`.

- [ ] **Step 6: Run everything and check in a browser**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass and the build succeeds.

Then start the dev server with `npm run dev` only if sign-in is possible; sign-in is not possible locally (the localhost redirect is not registered), so record in the task report that the interactive behaviour (dimming, picker, swipe, Today) was verified by code review and build only, and that the owner must check it on the phone.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: instant month switching feedback, Today, month picker and swipe

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Undo UI, toast, and the signed-in footer

**Files:**
- Create: `src/components/UndoSheet.tsx`
- Modify: `src/components/PortionBoard.tsx`, `src/app/page.tsx`
- Test: none for components (the repository has no component test setup; behaviour is covered by Task 3 service and route tests and by the manual phone check).

**Interfaces:**
- Consumes: `PortionCard.undoBlockedReason` (Task 3), `POST /api/payments/undo` (Task 3), `getViewer`/`Viewer` (Task 1).
- Produces: `UndoSheet` default export with props `{ monthKey: string; monthLabel: string; card: PortionCard; onClose: () => void; onDone: (message: string) => void }`.

- [ ] **Step 1: Create `src/components/UndoSheet.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";

type Props = {
  monthKey: string;
  monthLabel: string;
  card: PortionCard;
  onClose: () => void;
  onDone: (message: string) => void;
};

type ApiBody = {
  ok: boolean;
  error?: { code: string; message: string };
  logWritten?: boolean;
  logRow?: unknown[];
};

async function post(url: string, payload: unknown): Promise<ApiBody | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as ApiBody;
  } catch {
    return null;
  }
}

const NO_CONFIRMATION =
  "Couldn't confirm that the undo went through. Check your connection and refresh the page before trying again.";

export default function UndoSheet({ monthKey, monthLabel, card, onClose, onDone }: Props) {
  const router = useRouter();
  const entry = card.entry!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLog, setPendingLog] = useState<unknown[] | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function undo() {
    setBusy(true);
    setError(null);
    const body = await post("/api/payments/undo", {
      month: monthKey,
      portionId: card.portionId,
      expected: entry,
    });
    setBusy(false);
    if (!body) return setError(NO_CONFIRMATION);
    if (body.ok) {
      router.refresh();
      if (body.logWritten === false) return setPendingLog(body.logRow ?? []);
      onDone("Payment undone");
      return onClose();
    }
    if (body.error?.code === "conflict") router.refresh();
    setError(body.error?.message ?? "Something went wrong. Try again.");
  }

  async function retryLog() {
    setBusy(true);
    setError(null);
    const body = await post("/api/payments/log-retry", { row: pendingLog });
    setBusy(false);
    if (body?.ok && body.logWritten) {
      onDone("Payment undone");
      return onClose();
    }
    setError("The log entry still didn't save. The undo itself is safe in your Schedule.");
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="undo-title"
        className="max-h-dvh w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5"
      >
        <h2 id="undo-title" className="text-lg font-semibold">
          Undo payment?
        </h2>
        <p className="text-sm text-muted">
          {monthLabel} · {card.name}
        </p>

        {pendingLog ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              The payment was undone in your Schedule, but the Payments Log entry didn&apos;t save.
            </p>
            {error && (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={retryLog}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
            >
              {busy ? "Retrying…" : "Retry log entry"}
            </button>
            <button
              type="button"
              onClick={() => {
                onDone("Payment undone");
                onClose();
              }}
              disabled={busy}
              className="min-h-11 w-full text-muted"
            >
              Skip for now
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm">
              This clears {entry.tenant}&apos;s payment {entry.count} of {formatRupees(entry.amount)} for{" "}
              {card.name} in {monthLabel}. The Payments Log keeps a record.
            </p>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={undo}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-danger-bg px-4 font-medium text-danger-ink"
            >
              {busy ? "Undoing…" : "Undo payment"}
            </button>
            <button type="button" onClick={onClose} disabled={busy} className="min-h-11 w-full text-muted">
              Keep
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/components/PortionBoard.tsx`**

Add `useEffect` to the React import and import `UndoSheet`. Change the types and state:

```tsx
type Active = { mode: SheetMode | "undo"; portionId: string | null } | null;
```

Add inside the component:

```tsx
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
```

Replace the paid-card button block with:

```tsx
                  {card.status === "paid" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActive({ mode: "edit", portionId: card.portionId })}
                        className="min-h-11 flex-1 rounded-xl border border-control px-4 font-medium"
                      >
                        Edit amount
                      </button>
                      {card.undoBlockedReason === null && (
                        <button
                          type="button"
                          onClick={() => setActive({ mode: "undo", portionId: card.portionId })}
                          className="min-h-11 rounded-xl px-4 font-medium text-danger-ink underline"
                        >
                          Undo
                        </button>
                      )}
                    </>
                  )}
```

and, below the buttons `div` of each card (still inside the `<article>`), add:

```tsx
                {card.status === "paid" && card.undoBlockedReason && (
                  <p className="mt-2 text-sm text-muted">{card.undoBlockedReason}</p>
                )}
```

Replace the final `{active && ( <PaymentSheet ... /> )}` with:

```tsx
      {active &&
        (active.mode === "undo" ? (
          <UndoSheet
            key={`undo-${active.portionId}`}
            monthKey={monthKey}
            monthLabel={monthLabel}
            card={cards.find((c) => c.portionId === active.portionId)!}
            onClose={() => setActive(null)}
            onDone={setToast}
          />
        ) : (
          <PaymentSheet
            key={`${active.mode}-${active.portionId}`}
            mode={active.mode}
            monthKey={monthKey}
            monthLabel={monthLabel}
            cards={cards}
            initialPortionId={active.portionId}
            defaultDate={defaultDate}
            onClose={() => setActive(null)}
          />
        ))}

      {toast && (
        <p
          role="status"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl bg-foreground px-4 py-3 text-center text-sm text-background"
        >
          {toast}
        </p>
      )}
```

`cards.find(...)!` is safe because an Undo button is only rendered for a paid card with an entry. If the card list changes while the sheet is open and the card disappears, guard it: render `UndoSheet` only when the card exists and its status is `paid` (otherwise `setActive(null)` via the card lookup returning undefined → render nothing).

- [ ] **Step 3: Update the home footer in `src/app/page.tsx`**

Use the viewer. Replace the guard with:

```ts
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
```

and replace the footer with:

```tsx
      <footer className="mt-6 space-y-1 text-sm">
        <p className="text-muted">Signed in as {viewer.email}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/activity" className="grid min-h-11 place-items-center text-muted underline">
              Activity
            </Link>
            {viewer.isOwner && (
              <Link href="/settings" className="grid min-h-11 place-items-center text-muted underline">
                Portion settings
              </Link>
            )}
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="min-h-11 text-muted underline">
              Sign out
            </button>
          </form>
        </div>
      </footer>
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass; the build lists `/activity` and `/api/payments/undo`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: undo button and confirmation, toast, and who is signed in

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Real-Sheet check script and docs

**Files:**
- Create: `scripts/verify-testcopy.ts`
- Modify: `package.json`, `SETUP.md`, `README.md`, `docs/superpowers/specs/2026-10-06-wave-a-design.md`

**Interfaces:**
- Consumes: `getMonthView`, `logPayment`, `undoPayment`, `readActivity`, `withSnapshotCache`, `GoogleSheetsGateway.fromServiceAccount`, `readEnv`, `parseSchedule`, `readSettings`, `colLetter`.

- [ ] **Step 1: Create `scripts/verify-testcopy.ts`**

Open `scripts/recon.ts` first and copy its import style and its way of reading the environment, so the new script runs with `tsx --env-file=.env.local`.

```ts
import { colLetter } from "@/lib/sheets/a1";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { parseSchedule } from "@/lib/sheets/schedule";
import {
  getMonthView,
  logPayment,
  readActivity,
  undoPayment,
  withSnapshotCache,
  type SheetsContext,
} from "@/lib/sheets/service";
import { readSettings } from "@/lib/sheets/settings-store";
import { readEnv } from "@/lib/server/env";

/**
 * Exercises log, edit, undo, Activity and the cache against a TEST COPY of the
 * Sheet, through the real Google API. It refuses to run against the real Sheet.
 * Usage: TEST_SHEET_ID=<id of the test copy> npm run verify:testcopy
 */
const env = readEnv(process.env);
const testSheetId = process.env.TEST_SHEET_ID?.trim();
if (!testSheetId) throw new Error("Set TEST_SHEET_ID to the id of the TEST COPY of the Sheet.");
if (testSheetId === env.sheetId) {
  throw new Error("Refusing to run: TEST_SHEET_ID is the same as SHEET_ID (the real Sheet).");
}

const gateway = GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, testSheetId);
const raw: SheetsContext = { gateway, scheduleTab: env.scheduleTab, totalHeader: env.totalHeader };
const ctx = withSnapshotCache({ ...raw });

const MONTH = { year: 2040, month: 4 };
const PORTION = "p5";
const WHO = "verify@example.com";
const options = { now: new Date(), loggedBy: WHO };

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const started = Date.now();
  const value = await run();
  return [value, Date.now() - started];
}

async function rawCell(col: "tenant" | "count" | "amount"): Promise<unknown> {
  const portions = await readSettings(gateway);
  const values = await gateway.getValues(env.scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE");
  const { layout, rows } = parseSchedule(values, portions, env.totalHeader);
  const row = rows.find((r) => r.month.year === MONTH.year && r.month.month === MONTH.month);
  if (!row) throw new Error("The test copy has no row for 2040-04.");
  const a1 = `${colLetter(layout.portionCols[PORTION][col])}${row.rowNumber}`;
  const cells = await gateway.getValues(env.scheduleTab, a1, "UNFORMATTED_VALUE");
  return cells[0]?.[0];
}

const [first, firstMs] = await timed(() => getMonthView(ctx, MONTH));
check("2040-04 starts with no payment for p5", first.cards.find((c) => c.portionId === PORTION)?.status !== "paid");
if (failures > 0) throw new Error("The test copy's 2040-04 row is not empty for p5. Aborting before writing.");

const [, cachedMs] = await timed(() => getMonthView(ctx, { year: 2040, month: 3 }));
check("a second month view comes from the cache", cachedMs < firstMs / 2 || cachedMs < 20, `${firstMs} ms then ${cachedMs} ms`);

await logPayment(ctx, { month: MONTH, portionId: PORTION, amount: 1111, dateReceived: "2040-04-01", newTenantName: "Verify Tenant" }, options);
let card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
check("logging shows the payment", card.status === "paid" && card.entry?.amount === 1111);

await logPayment(ctx, { month: MONTH, portionId: PORTION, amount: 2222, dateReceived: "2040-04-01", overwrite: true }, options);
card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
check("editing changes the amount", card.entry?.amount === 2222);

await undoPayment(ctx, { month: MONTH, portionId: PORTION, expected: { tenant: "Verify Tenant", count: 1, amount: 2222 } }, options);
card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
check("undo returns the card to not paid", card.status !== "paid");
for (const col of ["tenant", "count", "amount"] as const) {
  const value = await rawCell(col);
  check(`undo left the ${col} cell blank`, value === undefined || value === "", JSON.stringify(value));
}

const activity = await readActivity(raw, 3);
check(
  "Activity lists Undone, Edited, Logged by the checker, newest first",
  activity.map((a) => a.action).join(",") === "Undone,Edited,Logged" && activity.every((a) => a.loggedBy === WHO),
  activity.map((a) => `${a.action}:${a.loggedBy}`).join(" "),
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
```

Add to `package.json` scripts: `"verify:testcopy": "tsx --env-file=.env.local scripts/verify-testcopy.ts"`.

Do NOT run this script in this task. It needs the owner's credentials and the test copy's id. Task 9 runs it.

- [ ] **Step 2: Update the docs**

`SETUP.md`:
- In the step 6 table replace the `ALLOWED_EMAIL` row with: `ALLOWED_EMAILS` | The Google accounts allowed to sign in, separated by commas. The first one is the owner and is the only person who can change Portion settings.
- In the "If sign-in fails" list change the "isn't allowed" line to mention `ALLOWED_EMAILS`.
- Add a section "## Adding another person" before "## 7. Deploy to Vercel": (1) in Google Cloud open the Google Auth Platform, Audience, Test users, Add users, and add their Google address; (2) add the address to `ALLOWED_EMAILS` in `.env.local` and in Vercel, then redeploy; (3) they open the app, sign in, and click through the "unverified app" warning; (4) they need no access to the Sheet. To remove someone, delete the address from `ALLOWED_EMAILS` and redeploy; they are locked out on their next request. Note that everyone listed can log, edit and undo; only the first address can change Portion settings.
- In step 7 item 2 replace the list of variables accordingly.

`README.md`: add one line under the feature list or overview mentioning undo, Activity and several people; keep the style of the existing text.

`docs/superpowers/specs/2026-10-06-wave-a-design.md`: change `Status:` to `approved by the owner; implemented per docs/superpowers/plans/2026-10-06-wave-a-implementation.md`.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: document ALLOWED_EMAILS and adding people; add a test-copy check script

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Gmail address normalisation

Why: Gmail ignores dots and anything after a `+` in the part before the `@`, and Google may report the address differently from how a person typed it (for example `First.Last@gmail.com` and `firstlast@gmail.com` are one account). An exact string match would lock such a person out at sign-in.

**Files:**
- Modify: `src/lib/server/env.ts`, `SETUP.md`
- Test: `tests/server/env.test.ts`

**Interfaces:**
- Produces (`env.ts`): `canonicalEmail(email: string): string`. `isAllowedEmail` and `isOwnerEmail` compare canonical forms of both sides. `parseAllowedEmails` still returns lower-cased, trimmed addresses as written, but drops a later address whose canonical form equals an earlier one (the first spelling wins, so the owner stays first).

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/env.test.ts` (import `canonicalEmail`):

```ts
describe("canonicalEmail", () => {
  it("lower-cases and trims", () => {
    expect(canonicalEmail("  Owner@Example.com ")).toBe("owner@example.com");
  });

  it("ignores dots and +tags in Gmail and Googlemail addresses", () => {
    expect(canonicalEmail("First.Last.S@gmail.com")).toBe("firstlasts@gmail.com");
    expect(canonicalEmail("a.b+rent@googlemail.com")).toBe("ab@gmail.com");
  });

  it("keeps dots and +tags for other domains", () => {
    expect(canonicalEmail("a.b+c@example.com")).toBe("a.b+c@example.com");
  });

  it("leaves text without an @ alone", () => {
    expect(canonicalEmail(" Not An Email ")).toBe("not an email");
  });
});

describe("Gmail variants in the allow-list", () => {
  it("treats dot and plus variants as the same account", () => {
    const allowed = ["firstlast.s@gmail.com", "owner@example.com"];
    expect(isAllowedEmail("first.last.s@gmail.com", allowed)).toBe(true);
    expect(isAllowedEmail("Firstlast.S+rent@gmail.com", allowed)).toBe(true);
    expect(isAllowedEmail("owner.x@example.com", allowed)).toBe(false);
  });

  it("recognises the owner under a different spelling", () => {
    expect(isOwnerEmail("first.last@gmail.com", ["firstlast@gmail.com", "b@example.com"])).toBe(true);
    expect(isOwnerEmail("b@example.com", ["firstlast@gmail.com", "b@example.com"])).toBe(false);
  });

  it("keeps only the first spelling of the same Gmail account when parsing", () => {
    expect(
      parseAllowedEmails({ ALLOWED_EMAILS: "first.last@gmail.com, firstlast@gmail.com, x@example.com" }),
    ).toEqual(["first.last@gmail.com", "x@example.com"]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/server/env.test.ts`
Expected: FAIL (`canonicalEmail` is not exported).

- [ ] **Step 3: Implement**

In `src/lib/server/env.ts` add above `isAllowedEmail`:

```ts
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Lower-case form used to compare addresses. Gmail ignores dots and "+tags", so they are removed. */
export function canonicalEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at === -1) return value;
  const domain = value.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return value;
  const local = value.slice(0, at).split("+")[0].replace(/\./g, "");
  return `${local}@gmail.com`;
}
```

Remove the old `norm` helper and make `isAllowedEmail` and `isOwnerEmail` compare `canonicalEmail(...)` of both sides. In `parseAllowedEmails` replace the `[...new Set(emails)]` de-duplication with one that keeps the first spelling per canonical form:

```ts
  const seen = new Set<string>();
  return emails.filter((email) => {
    const key = canonicalEmail(email);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
```

`SETUP.md`: in the "Adding another person" section add one sentence: "Gmail ignores dots and anything after a plus sign, so any spelling of the same Gmail address works in `ALLOWED_EMAILS`. Google Cloud may show the address in its own spelling in the Test users list."

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: treat Gmail dot and plus variants as the same account

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verify, review, merge and deploy (run by the lead, not a subagent)

This task has no new code. The lead runs it after Tasks 1 to 9 are reviewed.

- [ ] **Step 1: Full verification on the branch.** `npm ci` is not needed. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. All pass. Count the tests; the number must be higher than 171.
- [ ] **Step 2: Real Google check on the TEST COPY.** From the commented old `SHEET_ID` line in `.env.local`, take the test copy's id (do not print it). Run `NODE_OPTIONS=--use-system-ca TEST_SHEET_ID=<id> npm run verify:testcopy`. Every line must say PASS. The script refuses to run if the id equals the real `SHEET_ID`.
- [ ] **Step 3: Whole-branch review** by a fresh reviewer against the spec. Fix every Important finding and re-verify.
- [ ] **Step 4: Merge** `wave-a` into `main` (fast-forward or merge commit), confirm tests pass on `main`, and push. Vercel deploys. Wait for the deployment to be Ready.
- [ ] **Step 5: Google Cloud.** Add the extra accounts as Test users. Vercel: set `ALLOWED_EMAILS` (current owner first), then redeploy. Confirm Ready.
- [ ] **Step 6: Report** to the owner what was verified, what could not be verified (phone behaviour, a second account signing in), and the rollback (revert the merge on `main`; the Payments Log extra columns are harmless).
