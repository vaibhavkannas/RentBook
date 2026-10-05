# RentBook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a phone-first web app that records monthly rent receipts for five building portions and writes them into the owner's existing Google Sheet.

**Architecture:** Next.js (App Router) on Vercel. Pure rent rules and a thin Sheets gateway sit behind server route handlers. The Google Sheet is the only datastore; a service account writes single cells and appends a month row cloned from the last one. Google sign-in (Auth.js) is restricted to one email.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript 5, Tailwind CSS 4, Auth.js (`next-auth@5.0.0-beta.32`), `@googleapis/sheets`, zod 4, Vitest 5, tsx. Node 24.

**Spec:** `docs/superpowers/specs/2026-10-05-rentbook-design.md`

## Global Constraints

- The Google Sheet is the only datastore. No other database.
- The Schedule tab layout is never changed. The app writes only a portion's three cells (Tenant, Count, Amount), the total cell when the total is not a formula, and, for a new month, one new row cloned from the last month row.
- Every write to the Sheet is RAW: typed text is never interpreted as a formula.
- The app never guesses at sheet structure. A missing or renamed header, an unreadable Month format, or a non-empty row below the table stops the write with a message naming the problem.
- Default cycle length is 11 payments; `null` means the count never resets. Default hike is 5%. The hike is only a suggestion; the owner can edit the amount before saving.
- Rent amounts are whole rupees. Counts are whole numbers starting at 1.
- Dates and "current month" use the `Asia/Kolkata` time zone, not the server's.
- Access: Google sign-in through Auth.js, allowed only for the single email in `ALLOWED_EMAIL`. Every API route and page checks this on the server.
- Secrets (`GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID`, `AUTH_*`) live in `.env.local` and Vercel environment variables. They are never committed, never logged, never placed in docs. `.env.example` holds names only.
- Mobile first: layouts work at 360px width, tap targets are at least 44px tall, and the app supports light and dark mode.
- Do not point the app at the owner's live Sheet until the end-to-end pass on a copy (Task 18) is signed off.
- Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, added with a second `-m`.
- Next.js 16 differs from older versions. Before writing Next-specific code, check `node_modules/next/dist/docs/` (the scaffold's `AGENTS.md` says the same). `searchParams` is a Promise; route handlers take a Web `Request`.

## Notes: where this plan refines the spec

- **Environment variables added:** `SCHEDULE_TAB` (default `Schedule`) and `TOTAL_HEADER` (required). The photo cut off the total column's header, and the app must not guess it.
- **Month row creation** uses one atomic Google `batchUpdate` (copy the last month row, blank the payment cells, set the Month cell), so a failure can never leave last month's amounts under a new month.
- **Edit amount:** a Paid card's "Edit amount" button sends `overwrite: true`. Logging a payment on a Paid portion by other routes asks for confirmation first, as the spec requires.
- **Payments Log retry:** the server retries the log append 3 times; if it still fails, the Schedule write stands and the UI offers "Retry log entry".
- **Verified while planning:** every file shown below passed `vitest` (121 tests), `tsc --noEmit`, `eslint`, and `next build` in a scratch project, and a smoke test of the built server confirmed unauthenticated requests get 401 or a redirect to `/signin`. Not verifiable without real credentials: live Google API behavior and on-device UI. Task 12 and Task 18 cover those.

## Before you start (owner)

1. **Use a native Google Sheet.** The first link you shared ended in `rtpof=true&sd=true`, which marks an uploaded `.xlsx`. The Sheets API cannot write to those. In Drive, open the file and choose File, then Save as Google Sheets. The second link you shared looks native.
2. **Keep a backup,** and make a working copy named "RentBook test copy" (File, Make a copy). All development and testing uses the copy.
3. **Note two facts for Task 12:** the name of the tab with the month rows, and the exact header text of the monthly total column.

## File structure

```
RentBook/
  .env.example                      env var names only
  SETUP.md                          one-time Google Cloud + Vercel setup
  vitest.config.mts
  scripts/recon.ts                  read-only Sheet check (CLI)
  public/                           (scaffold default)
  src/
    auth.ts                         Auth.js config, one allowed email
    app/
      layout.tsx, globals.css       theme tokens, viewport, metadata
      manifest.ts, icon.tsx, apple-icon.tsx    installable PWA
      page.tsx                      month overview (server component)
      signin/page.tsx
      settings/page.tsx
      api/auth/[...nextauth]/route.ts
      api/payments/route.ts         POST log a payment
      api/payments/log-retry/route.ts
      api/settings/route.ts         PUT portion settings
    components/
      PortionBoard.tsx              cards + opens the sheet (client)
      PaymentSheet.tsx              log / edit / new tenant (client)
      SettingsForm.tsx              (client)
    lib/
      errors.ts                     AppError + factories
      format.ts                     rupees, month title
      domain/                       pure logic, no I/O
        types.ts  year-month.ts  rent-rules.ts  month-codec.ts  month-view.ts
      sheets/                       everything that touches the Sheet
        gateway.ts      interface
        a1.ts           column letters, A1 parsing
        schedule.ts     header detection, row parsing
        settings-store.ts   Settings + Payments Log tabs
        service.ts      getMonthView, logPayment, settings wrappers
        google-gateway.ts   real Google implementation
        google-errors.ts    friendly Google error messages
        recon.ts        read-only sheet report
      server/
        env.ts  context.ts  auth-guard.ts  http.ts  schemas.ts
  tests/
    support/fake-gateway.ts  fixtures.ts
    domain/  sheets/  server/
```

---

### Task 1: Scaffold the project and tooling

**Files:**
- Create (by scaffold): `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `src/app/*`, `public/*`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`
- Create: `vitest.config.mts`, `.env.example`
- Modify: `package.json` (name, scripts, dependencies), `.gitignore`

**Interfaces:**
- Produces: npm scripts `test`, `typecheck`, `recon`; alias `@` -> `src` in both TypeScript and Vitest.

- [ ] **Step 1: Commit the existing docs so the scaffold starts from a clean tree**

Run from the repo root (`RentBook/`):

```bash
git status --short
git add docs
git commit -m "docs: add RentBook design spec and implementation plan" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: the status shows only `docs/`. The commit succeeds.

- [ ] **Step 2: Scaffold Next.js into the repo root**

```bash
npx create-next-app@16.3.8 . --ts --tailwind --eslint --app --src-dir --use-npm --yes --skip-install
```

Expected: "Success! Created RentBook" (or similar). `docs/` is still there. If the command refuses because the folder is not empty, stop and report; do not delete anything.

- [ ] **Step 3: Install dependencies**

```bash
npm install
npm install next-auth@5.0.0-beta.32 @googleapis/sheets zod
npm install -D vitest @types/node@24 tsx
```

Expected: installs succeed. Warnings about `allow-scripts` or `unrs-resolver` are fine. `@types/node@24` is required: Vitest 5 fails to resolve against the scaffold's default `@types/node@20`.

- [ ] **Step 4: Set the package name and scripts**

In `package.json`, change `"name"` to `"rentbook"` and replace the `scripts` block with:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "typecheck": "tsc --noEmit",
  "recon": "tsx --env-file=.env.local scripts/recon.ts"
},
```

- [ ] **Step 5: Add the Vitest config**

Create `vitest.config.mts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Add the env template and let git track it**

The scaffold's `.gitignore` ignores `.env*`, which would also hide `.env.example`. Append this line to `.gitignore`:

```
!.env.example
```

Create `.env.example`:

```dotenv
# Copy to .env.local for local runs. Never commit .env.local.
# On Vercel, set the same names under Project Settings > Environment Variables.

# Auth.js: generate with `npx auth secret` or `openssl rand -base64 32`
AUTH_SECRET=
# Google OAuth client (Cloud Console > APIs & Services > Credentials)
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
# The only Google account allowed to sign in
ALLOWED_EMAIL=you@example.com

# Service account key JSON, pasted as one line
GOOGLE_SERVICE_ACCOUNT_JSON=
# The ID part of https://docs.google.com/spreadsheets/d/<ID>/edit
SHEET_ID=
# Name of the tab that holds the month rows
SCHEDULE_TAB=Schedule
# Exact header text of the monthly total column
TOTAL_HEADER=
```

- [ ] **Step 7: Verify the toolchain**

```bash
npm run lint
npx vitest run --passWithNoTests
npx next build
```

Expected: lint passes, Vitest reports no test files, and the build succeeds. The build also generates the `LayoutProps` type that `npm run typecheck` needs, so run `npm run typecheck` after it; it should pass.

- [ ] **Step 8: Commit the scaffold and push `main`**

```bash
git add -A
git status --short
git commit -m "chore: scaffold Next.js app with Vitest and tooling" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git branch --show-current
```

Check `git status` shows no `.env.local` and no `node_modules`. If the branch is not `main`, run `git branch -M main`.

**Ask the owner before pushing.** Pushing `main` publishes the repo's first commits to GitHub. On a yes:

```bash
git push -u origin main
git checkout -b feat/rentbook-v1
```

All later tasks commit on `feat/rentbook-v1`.

---

### Task 2: Shared types and year-month helpers

**Files:**
- Create: `src/lib/domain/types.ts`, `src/lib/domain/year-month.ts`
- Test: `tests/domain/year-month.test.ts`

**Interfaces:**
- Produces (`types.ts`): `YearMonth`, `PortionConfig`, `PortionEntry`, `ScheduleRow`, `NextPayment`, `CardStatus`, `PortionCard`, `MonthView`.
- Produces (`year-month.ts`): `ymKey(ym): string`, `parseYmKey(s): YearMonth | null`, `compareYm(a, b): number`, `addMonths(ym, delta): YearMonth`, `serialFromYm(ym): number`, `ymFromSerial(n): YearMonth`, `currentYm(now, tz?): YearMonth`, `todayIso(now, tz?): string`, `isValidIsoDay(s): boolean`, `monthName(month, long): string`, `monthIndexFromName(name): number | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/year-month.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addMonths,
  compareYm,
  currentYm,
  isValidIsoDay,
  monthIndexFromName,
  monthName,
  parseYmKey,
  serialFromYm,
  todayIso,
  ymFromSerial,
  ymKey,
} from "@/lib/domain/year-month";

describe("ymKey / parseYmKey", () => {
  it("formats with zero padding", () => {
    expect(ymKey({ year: 2026, month: 3 })).toBe("2026-03");
  });
  it("parses a valid key", () => {
    expect(parseYmKey("2026-10")).toEqual({ year: 2026, month: 10 });
  });
  it("rejects bad keys", () => {
    expect(parseYmKey("2026-13")).toBeNull();
    expect(parseYmKey("2026-1")).toBeNull();
    expect(parseYmKey("Oct-26")).toBeNull();
  });
});

describe("compareYm / addMonths", () => {
  it("orders across years", () => {
    expect(compareYm({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBeLessThan(0);
    expect(compareYm({ year: 2026, month: 5 }, { year: 2026, month: 5 })).toBe(0);
  });
  it("rolls over year boundaries in both directions", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 });
  });
});

describe("sheets serials", () => {
  it("matches known serials", () => {
    expect(serialFromYm({ year: 1970, month: 1 })).toBe(25569);
    expect(serialFromYm({ year: 2020, month: 1 })).toBe(43831);
  });
  it("round-trips, including mid-month serials", () => {
    expect(ymFromSerial(43831)).toEqual({ year: 2020, month: 1 });
    expect(ymFromSerial(43831 + 20.5)).toEqual({ year: 2020, month: 1 });
    expect(ymFromSerial(serialFromYm({ year: 2026, month: 10 }))).toEqual({ year: 2026, month: 10 });
  });
});

describe("time zone helpers", () => {
  it("uses Asia/Kolkata, not UTC", () => {
    const lateUtc = new Date("2026-09-30T20:00:00Z");
    expect(todayIso(lateUtc)).toBe("2026-10-01");
    expect(currentYm(lateUtc)).toEqual({ year: 2026, month: 10 });
  });
});

describe("isValidIsoDay", () => {
  it("accepts real dates only", () => {
    expect(isValidIsoDay("2026-10-05")).toBe(true);
    expect(isValidIsoDay("2026-02-30")).toBe(false);
    expect(isValidIsoDay("05-10-2026")).toBe(false);
  });
});

describe("month names", () => {
  it("formats and parses short and long names", () => {
    expect(monthName(1, false)).toBe("Jan");
    expect(monthName(9, true)).toBe("September");
    expect(monthIndexFromName("sep")).toBe(9);
    expect(monthIndexFromName("September")).toBe(9);
    expect(monthIndexFromName("Sept")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/year-month.test.ts`
Expected: FAIL, cannot resolve `@/lib/domain/year-month`.

- [ ] **Step 3: Write the types**

Create `src/lib/domain/types.ts`:

```ts
export type YearMonth = { year: number; month: number };

export type PortionConfig = {
  id: string;
  name: string;
  tenantHeader: string;
  countHeader: string;
  amountHeader: string;
  /** Payments per cycle. null means the count never resets. */
  cycleLength: number | null;
  hikePercent: number;
};

export type PortionEntry = { tenant: string; count: number; amount: number };

export type ScheduleRow = {
  /** 1-based row number in the Schedule tab. */
  rowNumber: number;
  month: YearMonth;
  entries: Record<string, PortionEntry | null>;
};

export type NextPayment = {
  tenant: string;
  count: number;
  suggestedAmount: number;
  previousAmount: number;
  startsNewCycle: boolean;
};

export type CardStatus = "paid" | "pending" | "needs-tenant";

export type PortionCard = {
  portionId: string;
  name: string;
  cycleLength: number | null;
  status: CardStatus;
  entry: PortionEntry | null;
  next: NextPayment | null;
};

export type MonthView = {
  month: YearMonth;
  cards: PortionCard[];
  received: number;
  expected: number;
  paidCount: number;
};
```

- [ ] **Step 4: Write the helpers**

Create `src/lib/domain/year-month.ts`:

```ts
import type { YearMonth } from "./types";

const KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Days from 1899-12-30 (Google Sheets serial 0) to 1970-01-01. */
const SERIAL_UNIX_OFFSET = 25569;
const MS_PER_DAY = 86_400_000;

export function ymKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

export function parseYmKey(value: string): YearMonth | null {
  const match = KEY_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function compareYm(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Serial number of the first day of the month, as Google Sheets stores dates. */
export function serialFromYm(ym: YearMonth): number {
  return Date.UTC(ym.year, ym.month - 1, 1) / MS_PER_DAY + SERIAL_UNIX_OFFSET;
}

export function ymFromSerial(serial: number): YearMonth {
  const date = new Date((Math.floor(serial) - SERIAL_UNIX_OFFSET) * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Calendar month that `now` falls in, for the given IANA time zone. */
export function currentYm(now: Date, timeZone = "Asia/Kolkata"): YearMonth {
  const [year, month] = todayIso(now, timeZone).split("-").map(Number);
  return { year, month };
}

/** Calendar day of `now` as YYYY-MM-DD in the given IANA time zone. */
export function todayIso(now: Date, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidIsoDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const LONG_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(month: number, long: boolean): string {
  const name = LONG_NAMES[month - 1];
  return long ? name : name.slice(0, 3);
}

export function monthIndexFromName(name: string): number | null {
  const lower = name.toLowerCase();
  const index = LONG_NAMES.findIndex(
    (long) => long.toLowerCase() === lower || long.slice(0, 3).toLowerCase() === lower,
  );
  return index === -1 ? null : index + 1;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/domain/year-month.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/domain tests/domain
git commit -m "feat: add shared types and year-month helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rent rules

**Files:**
- Create: `src/lib/domain/rent-rules.ts`
- Test: `tests/domain/rent-rules.test.ts`

**Interfaces:**
- Produces: `startsNewCycle(lastCount, cycleLength): boolean`, `nextCount(lastCount, cycleLength): number`, `suggestAmount(previousAmount, hikePercent, newCycle): number`, `sumAmounts(amounts): number`. `cycleLength` is `number | null`; `null` never wraps.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/rent-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  nextCount,
  startsNewCycle,
  suggestAmount,
  sumAmounts,
} from "@/lib/domain/rent-rules";

describe("nextCount", () => {
  it("increments inside a cycle", () => {
    expect(nextCount(1, 11)).toBe(2);
    expect(nextCount(10, 11)).toBe(11);
  });
  it("wraps to 1 after the last payment of the cycle", () => {
    expect(nextCount(11, 11)).toBe(1);
  });
  it("wraps at a per-portion cycle length", () => {
    expect(nextCount(6, 6)).toBe(1);
    expect(nextCount(5, 6)).toBe(6);
  });
  it("never wraps when cycle length is null", () => {
    expect(nextCount(11, null)).toBe(12);
    expect(nextCount(40, null)).toBe(41);
  });
  it("treats a count above the cycle length as the end of a cycle", () => {
    expect(nextCount(12, 11)).toBe(1);
  });
});

describe("startsNewCycle", () => {
  it("is true only when the last payment completed the cycle", () => {
    expect(startsNewCycle(11, 11)).toBe(true);
    expect(startsNewCycle(10, 11)).toBe(false);
    expect(startsNewCycle(99, null)).toBe(false);
  });
});

describe("suggestAmount", () => {
  it("keeps the rent inside a cycle", () => {
    expect(suggestAmount(9000, 5, false)).toBe(9000);
  });
  it("adds the hike for a new cycle", () => {
    expect(suggestAmount(9000, 5, true)).toBe(9450);
  });
  it("rounds half up to a whole rupee", () => {
    expect(suggestAmount(5450, 5, true)).toBe(5723);
    expect(suggestAmount(12700, 5, true)).toBe(13335);
  });
  it("supports a per-portion hike percent, including zero", () => {
    expect(suggestAmount(10000, 10, true)).toBe(11000);
    expect(suggestAmount(10000, 0, true)).toBe(10000);
  });
});

describe("sumAmounts", () => {
  it("treats missing amounts as zero", () => {
    expect(sumAmounts([5450, null, 9000, undefined])).toBe(14450);
    expect(sumAmounts([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/rent-rules.test.ts`
Expected: FAIL, cannot resolve `@/lib/domain/rent-rules`.

- [ ] **Step 3: Implement**

Create `src/lib/domain/rent-rules.ts`:

```ts
/** True when the payment after `lastCount` starts a new cycle. */
export function startsNewCycle(lastCount: number, cycleLength: number | null): boolean {
  return cycleLength !== null && lastCount >= cycleLength;
}

/** Payment number of the next payment: lastCount + 1, wrapping to 1 after a full cycle. */
export function nextCount(lastCount: number, cycleLength: number | null): number {
  return startsNewCycle(lastCount, cycleLength) ? 1 : lastCount + 1;
}

/**
 * Suggested rent for the next payment. Only a new cycle raises the rent; the
 * result is a whole rupee and the owner can always edit it before saving.
 */
export function suggestAmount(
  previousAmount: number,
  hikePercent: number,
  newCycle: boolean,
): number {
  if (!newCycle) return previousAmount;
  return Math.round((previousAmount * (100 + hikePercent)) / 100);
}

export function sumAmounts(amounts: Array<number | null | undefined>): number {
  return amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/domain/rent-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/rent-rules.ts tests/domain/rent-rules.test.ts
git commit -m "feat: add rent cycle, count, and hike rules" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Errors and the Month column codec

**Files:**
- Create: `src/lib/errors.ts`, `src/lib/domain/month-codec.ts`
- Test: `tests/domain/month-codec.test.ts`

**Interfaces:**
- Consumes: `YearMonth`, `serialFromYm`, `ymFromSerial`, `monthName`, `monthIndexFromName`.
- Produces (`errors.ts`): class `AppError(code, message, details?)` with `code` one of `"unauthorized" | "validation" | "conflict" | "sheet-structure" | "config"`; factories `unauthorized()`, `validation(msg)`, `conflict(msg, details?)`, `sheetStructure(msg)`, `configError(msg)`.
- Produces (`month-codec.ts`): type `MonthCodec`, `detectMonthCodec(sample: unknown): MonthCodec` (throws `sheet-structure` if unreadable), `readMonth(codec, cell): YearMonth | null`, `writeMonth(codec, ym): string | number`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/month-codec.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectMonthCodec, readMonth, writeMonth } from "@/lib/domain/month-codec";
import { AppError } from "@/lib/errors";

describe("detectMonthCodec", () => {
  it("detects date cells as serial", () => {
    expect(detectMonthCodec(43831)).toEqual({ kind: "serial" });
  });
  it("detects short text with a dash", () => {
    expect(detectMonthCodec("Oct-26")).toEqual({
      kind: "text",
      style: { longName: false, separator: "-", fourDigitYear: false },
    });
  });
  it("detects long text with a space and four-digit year", () => {
    expect(detectMonthCodec("October 2026")).toEqual({
      kind: "text",
      style: { longName: true, separator: " ", fourDigitYear: true },
    });
  });
  it("refuses to guess unknown formats", () => {
    expect(() => detectMonthCodec("10/2026")).toThrow(AppError);
    expect(() => detectMonthCodec(undefined)).toThrow(/Month column format/);
  });
});

describe("readMonth / writeMonth", () => {
  it("reads and writes serial months", () => {
    const codec = detectMonthCodec(43831);
    expect(readMonth(codec, 43831)).toEqual({ year: 2020, month: 1 });
    expect(writeMonth(codec, { year: 2020, month: 1 })).toBe(43831);
  });
  it("reads and writes text months in the detected style", () => {
    const codec = detectMonthCodec("Jan-20");
    expect(readMonth(codec, "Feb-20")).toEqual({ year: 2020, month: 2 });
    expect(writeMonth(codec, { year: 2026, month: 10 })).toBe("Oct-26");
    const long = detectMonthCodec("October 2026");
    expect(writeMonth(long, { year: 2027, month: 1 })).toBe("January 2027");
  });
  it("returns null for cells that are not months", () => {
    expect(readMonth({ kind: "serial" }, "Total")).toBeNull();
    expect(readMonth(detectMonthCodec("Jan-20"), 5)).toBeNull();
    expect(readMonth(detectMonthCodec("Jan-20"), "Total")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/month-codec.test.ts`
Expected: FAIL, cannot resolve `@/lib/domain/month-codec`.

- [ ] **Step 3: Write the error types**

Create `src/lib/errors.ts`:

```ts
export class AppError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "validation"
      | "conflict"
      | "sheet-structure"
      | "config",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () =>
  new AppError("unauthorized", "Sign in with the allowed Google account.");

export const validation = (message: string) => new AppError("validation", message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("conflict", message, details);

export const sheetStructure = (message: string) =>
  new AppError("sheet-structure", message);

export const configError = (message: string) => new AppError("config", message);
```

- [ ] **Step 4: Write the codec**

Create `src/lib/domain/month-codec.ts`:

```ts
import { sheetStructure } from "@/lib/errors";
import type { YearMonth } from "./types";
import {
  monthIndexFromName,
  monthName,
  serialFromYm,
  ymFromSerial,
} from "./year-month";

export type TextStyle = {
  longName: boolean;
  separator: " " | "-";
  fourDigitYear: boolean;
};

/**
 * How the Month column stores its value. `serial` is a real date cell;
 * `text` is a string such as "Oct-26" or "October 2026".
 */
export type MonthCodec =
  | { kind: "serial" }
  | { kind: "text"; style: TextStyle };

const TEXT_PATTERN = /^([A-Za-z]{3,9})([ -])(\d{2}|\d{4})$/;

function parseText(text: string): { ym: YearMonth; style: TextStyle } | null {
  const match = TEXT_PATTERN.exec(text.trim());
  if (!match) return null;
  const month = monthIndexFromName(match[1]);
  if (month === null) return null;
  const fourDigitYear = match[3].length === 4;
  const year = fourDigitYear ? Number(match[3]) : 2000 + Number(match[3]);
  return {
    ym: { year, month },
    style: {
      longName: match[1].length > 3,
      separator: match[2] as " " | "-",
      fourDigitYear,
    },
  };
}

/**
 * Work out the Month column's format from one existing cell. Refuses to
 * guess: an unrecognised value stops the app instead of writing a bad month.
 */
export function detectMonthCodec(sample: unknown): MonthCodec {
  if (typeof sample === "number") return { kind: "serial" };
  if (typeof sample === "string") {
    const parsed = parseText(sample);
    if (parsed) return { kind: "text", style: parsed.style };
  }
  throw sheetStructure(
    `Could not read the Month column format from "${String(sample)}". Expected a date or text like "Oct-26".`,
  );
}

export function readMonth(codec: MonthCodec, cell: unknown): YearMonth | null {
  if (codec.kind === "serial") {
    return typeof cell === "number" ? ymFromSerial(cell) : null;
  }
  return typeof cell === "string" ? (parseText(cell)?.ym ?? null) : null;
}

export function writeMonth(codec: MonthCodec, ym: YearMonth): string | number {
  if (codec.kind === "serial") return serialFromYm(ym);
  const { longName, separator, fourDigitYear } = codec.style;
  const year = fourDigitYear ? String(ym.year) : String(ym.year % 100).padStart(2, "0");
  return `${monthName(ym.month, longName)}${separator}${year}`;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/domain/month-codec.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/errors.ts src/lib/domain/month-codec.ts tests/domain/month-codec.test.ts
git commit -m "feat: add AppError types and Month column codec" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sheets gateway interface, A1 helpers, and the test fake

**Files:**
- Create: `src/lib/sheets/gateway.ts`, `src/lib/sheets/a1.ts`, `tests/support/fake-gateway.ts`
- Test: `tests/sheets/a1.test.ts`

**Interfaces:**
- Produces (`gateway.ts`): `ValueRender`, `CellWrite {tab, a1, values}`, `RowOverride {col, value}`, interface `SheetsGateway` with `listTabs()`, `addTab(title)`, `getValues(tab, a1, render)`, `updateValues(writes)`, `appendRow(tab, row)`, `cloneRow(tab, fromRow, toRow, clearCols, overrides)`. `cloneRow` must be atomic.
- Produces (`a1.ts`): `colLetter(index0): string`, `colIndex(letters): number`, `parseA1(a1): A1Range`.
- Produces (`fake-gateway.ts`): class `FakeGateway` (`tabs`, `failOn`, `calls`), helper `cell(fake, tab, letters, row)`.

- [ ] **Step 1: Write the failing test**

Create `tests/sheets/a1.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { colIndex, colLetter, parseA1 } from "@/lib/sheets/a1";

describe("column letters", () => {
  it("converts both ways", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(701)).toBe("ZZ");
    expect(colIndex("A")).toBe(0);
    expect(colIndex("AA")).toBe(26);
    expect(colIndex("ZZ")).toBe(701);
  });
});

describe("parseA1", () => {
  it("parses open-ended ranges", () => {
    expect(parseA1("A1:ZZ")).toEqual({ startCol: 0, endCol: 701, startRow: 1, endRow: null });
  });
  it("parses a row range", () => {
    expect(parseA1("A12:ZZ12")).toEqual({ startCol: 0, endCol: 701, startRow: 12, endRow: 12 });
  });
  it("parses a single cell", () => {
    expect(parseA1("D5")).toEqual({ startCol: 3, endCol: 3, startRow: 5, endRow: 5 });
  });
  it("rejects unsupported input", () => {
    expect(() => parseA1("Sheet1!A1")).toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sheets/a1.test.ts`
Expected: FAIL, cannot resolve `@/lib/sheets/a1`.

- [ ] **Step 3: Write the A1 helpers**

Create `src/lib/sheets/a1.ts`:

```ts
/** 0-based column index to letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function colLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Letters to 0-based column index: A -> 0, AA -> 26. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const char of letters) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

export type A1Range = {
  startCol: number;
  endCol: number | null;
  startRow: number;
  endRow: number | null;
};

const A1_PATTERN = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/;

/** Parses "A1:ZZ", "B5", "A12:ZZ12". Missing rows mean "to the end". */
export function parseA1(a1: string): A1Range {
  const match = A1_PATTERN.exec(a1);
  if (!match) throw new Error(`Unsupported A1 range: ${a1}`);
  const startCol = colIndex(match[1]);
  const startRow = match[2] ? Number(match[2]) : 1;
  if (match[3] === undefined) {
    return { startCol, endCol: startCol, startRow, endRow: match[2] ? startRow : null };
  }
  return {
    startCol,
    endCol: colIndex(match[3]),
    startRow,
    endRow: match[4] ? Number(match[4]) : null,
  };
}
```

- [ ] **Step 4: Write the gateway interface**

Create `src/lib/sheets/gateway.ts`:

```ts
export type ValueRender = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";

export type CellWrite = { tab: string; a1: string; values: unknown[][] };

export type RowOverride = { col: number; value: string | number };

/**
 * The only surface the rest of the app uses to reach a spreadsheet. The real
 * implementation talks to Google Sheets; tests use an in-memory fake.
 * All writes are RAW: text is never interpreted as a formula.
 */
export interface SheetsGateway {
  listTabs(): Promise<string[]>;
  addTab(title: string): Promise<void>;
  /** Rows may be ragged and trailing empty cells are omitted. */
  getValues(tab: string, a1: string, render: ValueRender): Promise<unknown[][]>;
  updateValues(writes: CellWrite[]): Promise<void>;
  /** Appends one row after the last row of the tab's table. */
  appendRow(tab: string, row: unknown[]): Promise<void>;
  /**
   * Creates `toRow` as a copy of `fromRow` (values, formulas with relative
   * references adjusted, and formatting), then blanks `clearCols` and sets
   * `overrides`. Must be atomic: either the finished row exists or nothing
   * changed. Rows are 1-based, columns are 0-based.
   */
  cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ): Promise<void>;
}
```

- [ ] **Step 5: Write the in-memory fake used by later tests**

Create `tests/support/fake-gateway.ts`:

```ts
import { colIndex, parseA1 } from "@/lib/sheets/a1";
import type { CellWrite, RowOverride, SheetsGateway } from "@/lib/sheets/gateway";

type Grid = unknown[][];

/**
 * In-memory SheetsGateway for tests. Formula cells are strings starting with
 * "=" and are returned as-is for every render mode (no evaluation).
 * cloneRow shifts relative row references (A5 -> A6) the way Google does for
 * a plain copy/paste; absolute rows ($5) are left alone. Methods listed in
 * `failOn` throw on every call while they stay listed.
 */
export class FakeGateway implements SheetsGateway {
  readonly tabs = new Map<string, Grid>();
  failOn = new Set<keyof SheetsGateway>();
  calls: string[] = [];

  constructor(initial: Record<string, Grid> = {}) {
    for (const [title, grid] of Object.entries(initial)) {
      this.tabs.set(title, grid.map((row) => [...row]));
    }
  }

  private grid(tab: string): Grid {
    const grid = this.tabs.get(tab);
    if (!grid) throw new Error(`No tab named ${tab}`);
    return grid;
  }

  private enter(method: keyof SheetsGateway) {
    this.calls.push(method);
    if (this.failOn.has(method)) throw new Error(`${method} failed`);
  }

  async listTabs() {
    this.enter("listTabs");
    return [...this.tabs.keys()];
  }

  async addTab(title: string) {
    this.enter("addTab");
    this.tabs.set(title, []);
  }

  async getValues(tab: string, a1: string) {
    this.enter("getValues");
    const range = parseA1(a1);
    const grid = this.grid(tab);
    const lastRow = range.endRow ?? grid.length;
    const out: Grid = [];
    for (let r = range.startRow; r <= Math.min(lastRow, grid.length); r++) {
      const row = grid[r - 1] ?? [];
      const endCol = range.endCol ?? row.length - 1;
      const slice = row.slice(range.startCol, Math.min(endCol, row.length - 1) + 1);
      while (slice.length > 0 && isEmpty(slice[slice.length - 1])) slice.pop();
      out.push(slice);
    }
    while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  async updateValues(writes: CellWrite[]) {
    this.enter("updateValues");
    for (const write of writes) {
      const range = parseA1(write.a1);
      const grid = this.grid(write.tab);
      write.values.forEach((values, dr) => {
        const rowIndex = range.startRow - 1 + dr;
        while (grid.length <= rowIndex) grid.push([]);
        values.forEach((value, dc) => {
          grid[rowIndex][range.startCol + dc] = value;
        });
      });
    }
  }

  async appendRow(tab: string, row: unknown[]) {
    this.enter("appendRow");
    this.grid(tab).push([...row]);
  }

  async cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ) {
    this.enter("cloneRow");
    const grid = this.grid(tab);
    const source = grid[fromRow - 1] ?? [];
    const delta = toRow - fromRow;
    const copy = source.map((cell) =>
      typeof cell === "string" && cell.startsWith("=") ? shiftRows(cell, delta) : cell,
    );
    for (const col of clearCols) delete copy[col];
    for (const { col, value } of overrides) copy[col] = value;
    while (grid.length < toRow) grid.push([]);
    grid[toRow - 1] = copy;
  }
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === "";
}

function shiftRows(formula: string, delta: number) {
  return formula.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (match, col, abs, row) =>
    abs === "$" ? match : `${col}${Number(row) + delta}`,
  );
}

/** Test helper: a cell by column letters and 1-based row. */
export function cell(fake: FakeGateway, tab: string, letters: string, row: number) {
  return fake.tabs.get(tab)?.[row - 1]?.[colIndex(letters)];
}
```

- [ ] **Step 6: Run the test and typecheck**

Run: `npx vitest run tests/sheets/a1.test.ts && npm run typecheck`
Expected: PASS, and the typecheck passes (the fake implements the interface).

- [ ] **Step 7: Commit**

```bash
git add src/lib/sheets/a1.ts src/lib/sheets/gateway.ts tests/support tests/sheets/a1.test.ts
git commit -m "feat: add Sheets gateway interface, A1 helpers, and in-memory fake" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Parse the Schedule tab

**Files:**
- Create: `src/lib/sheets/schedule.ts`, `tests/support/fixtures.ts`
- Test: `tests/sheets/schedule.test.ts`

**Interfaces:**
- Consumes: `detectMonthCodec`, `readMonth`, `MonthCodec`, `PortionConfig`, `PortionEntry`, `ScheduleRow`, `sheetStructure`.
- Produces (`schedule.ts`): type `ScheduleLayout {headerRow, monthCol, totalCol, portionCols, codec, lastDataRow}`, `findHeaderRowIndex(values): number`, `parseSchedule(values, portions, totalHeader): { layout, rows }`.
- Produces (`fixtures.ts`): `TOTAL_HEADER`, `PORTIONS`, `SCHEDULE_HEADERS`, `scheduleRow(...)`, `monthCell(style, year, month)`, `baseSchedule(style?)`. `baseSchedule` models a sheet with a banner above the header (header on row 3), months Aug-26 and Sep-26, and a total formula in each row.

- [ ] **Step 1: Write the fixtures and the failing test**

Create `tests/support/fixtures.ts`:

```ts
import type { PortionConfig } from "@/lib/domain/types";
import { serialFromYm } from "@/lib/domain/year-month";

export const TOTAL_HEADER = "Total Rent";

export const PORTIONS: PortionConfig[] = [
  ["p1", "First floor, single bedroom", ""],
  ["p2", "First floor, double bedroom", "2"],
  ["p3", "Second floor, single bedroom", "3"],
  ["p4", "Second floor, double bedroom", "4"],
  ["p5", "Third floor, hall and kitchen", "5"],
].map(([id, name, suffix]) => ({
  id,
  name,
  tenantHeader: `Tenant${suffix}`,
  countHeader: `Count${suffix}`,
  amountHeader: `Amount${suffix}`,
  cycleLength: 11,
  hikePercent: 5,
}));

export const SCHEDULE_HEADERS = [
  "Month",
  ...PORTIONS.flatMap((p) => [p.tenantHeader, p.countHeader, p.amountHeader]),
  TOTAL_HEADER,
];

type Entry = [tenant: string, count: number, amount: number] | null;

/**
 * One data row. `entries` has one item per portion. The total column holds a
 * formula in the style of the owner's sheet, so copyRow can be checked.
 */
export function scheduleRow(
  month: string | number,
  entries: Entry[],
  rowNumber: number,
  total: "formula" | number = "formula",
): unknown[] {
  const cells: unknown[] = [month];
  for (const entry of entries) {
    cells.push(...(entry ?? []));
    if (!entry) cells.push(undefined, undefined, undefined);
  }
  cells.push(
    total === "formula"
      ? `=D${rowNumber}+G${rowNumber}+J${rowNumber}+M${rowNumber}+P${rowNumber}`
      : total,
  );
  return cells;
}

export type MonthStyle = "text" | "serial";

export function monthCell(style: MonthStyle, year: number, month: number): string | number {
  if (style === "serial") return serialFromYm({ year, month });
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[month - 1]}-${String(year % 100).padStart(2, "0")}`;
}

/**
 * A Schedule tab with a banner above the header (header on row 3) and two
 * months of history: Aug-26 and Sep-26.
 * After Sep-26: p1 is at count 3, p2 at 11 (cycle ends), p3 at 5, p4 has no
 * tenant ever, p5 started in Sep-26 (count 1).
 */
export function baseSchedule(style: MonthStyle = "text"): unknown[][] {
  return [
    ["Rent Receipts Schedule"],
    [],
    [...SCHEDULE_HEADERS],
    scheduleRow(
      monthCell(style, 2026, 8),
      [["Asha", 2, 5450], ["Bala", 10, 12700], ["Chitra", 4, 9000], null, null],
      4,
    ),
    scheduleRow(
      monthCell(style, 2026, 9),
      [["Asha", 3, 5450], ["Bala", 11, 12700], ["Chitra", 5, 9000], null, ["Esha", 1, 5100]],
      5,
    ),
  ];
}
```

Create `tests/sheets/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { parseSchedule } from "@/lib/sheets/schedule";
import {
  baseSchedule,
  monthCell,
  PORTIONS,
  scheduleRow,
  TOTAL_HEADER,
} from "../support/fixtures";

describe("parseSchedule", () => {
  it("finds the header below a banner and maps every portion's columns", () => {
    const { layout } = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
    expect(layout.headerRow).toBe(3);
    expect(layout.monthCol).toBe(0);
    expect(layout.totalCol).toBe(16);
    expect(layout.portionCols.p1).toEqual({ tenant: 1, count: 2, amount: 3 });
    expect(layout.portionCols.p5).toEqual({ tenant: 13, count: 14, amount: 15 });
    expect(layout.lastDataRow).toBe(5);
    expect(layout.codec).toEqual({
      kind: "text",
      style: { longName: false, separator: "-", fourDigitYear: false },
    });
  });

  it("reads months and entries, with null for vacant portions", () => {
    const { rows } = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
    expect(rows).toHaveLength(2);
    expect(rows[1].rowNumber).toBe(5);
    expect(rows[1].month).toEqual({ year: 2026, month: 9 });
    expect(rows[1].entries.p1).toEqual({ tenant: "Asha", count: 3, amount: 5450 });
    expect(rows[1].entries.p4).toBeNull();
  });

  it("works when the Month column holds real dates", () => {
    const { layout, rows } = parseSchedule(baseSchedule("serial"), PORTIONS, TOTAL_HEADER);
    expect(layout.codec).toEqual({ kind: "serial" });
    expect(rows[0].month).toEqual({ year: 2026, month: 8 });
  });

  it("ignores a footer row under the table", () => {
    const values = baseSchedule();
    values.push(["Grand total", undefined, undefined, 123]);
    const { rows, layout } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
    expect(rows).toHaveLength(2);
    expect(layout.lastDataRow).toBe(5);
  });

  it("reports a missing header by name and never guesses", () => {
    const values = baseSchedule();
    (values[2] as string[])[4] = "Tenant two";
    expect(() => parseSchedule(values, PORTIONS, TOTAL_HEADER)).toThrow(
      /Header "Tenant2" was not found/,
    );
  });

  it("reports a missing total header", () => {
    expect(() => parseSchedule(baseSchedule(), PORTIONS, "Per Month")).toThrow(
      /Header "Per Month" was not found/,
    );
  });

  it("rejects a duplicated header", () => {
    const values = baseSchedule();
    (values[2] as string[])[7] = "Tenant";
    expect(() => parseSchedule(values, PORTIONS, TOTAL_HEADER)).toThrow(/more than once/);
  });

  it("fails clearly when there is no header or no month rows", () => {
    expect(() => parseSchedule([["nothing"]], PORTIONS, TOTAL_HEADER)).toThrow(AppError);
    const headerOnly = baseSchedule().slice(0, 3);
    expect(() => parseSchedule(headerOnly, PORTIONS, TOTAL_HEADER)).toThrow(/no month rows/);
  });

  it("treats a row with a month but no numbers as vacant for every portion", () => {
    const values = baseSchedule();
    values.push(scheduleRow(monthCell("text", 2026, 10), [null, null, null, null, null], 6));
    const { rows } = parseSchedule(values, PORTIONS, TOTAL_HEADER);
    expect(rows[2].month).toEqual({ year: 2026, month: 10 });
    expect(Object.values(rows[2].entries).every((e) => e === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sheets/schedule.test.ts`
Expected: FAIL, cannot resolve `@/lib/sheets/schedule`.

- [ ] **Step 3: Implement**

Create `src/lib/sheets/schedule.ts`:

```ts
import {
  detectMonthCodec,
  readMonth,
  type MonthCodec,
} from "@/lib/domain/month-codec";
import type { PortionConfig, PortionEntry, ScheduleRow } from "@/lib/domain/types";
import { sheetStructure } from "@/lib/errors";

export type ScheduleLayout = {
  /** 1-based row number of the header row. */
  headerRow: number;
  monthCol: number;
  totalCol: number;
  portionCols: Record<string, { tenant: number; count: number; amount: number }>;
  codec: MonthCodec;
  /** 1-based row number of the last row holding a month. */
  lastDataRow: number;
};

const HEADER_SEARCH_ROWS = 25;

const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();

function findColumn(headers: unknown[], name: string): number {
  const wanted = norm(name);
  const matches = headers.flatMap((header, index) => (norm(header) === wanted ? [index] : []));
  if (matches.length === 0) {
    throw sheetStructure(`Header "${name}" was not found in the Schedule tab.`);
  }
  if (matches.length > 1) {
    throw sheetStructure(`Header "${name}" appears more than once in the Schedule tab.`);
  }
  return matches[0];
}

/** 0-based index of the row that holds the "Month" header, or -1. */
export function findHeaderRowIndex(values: unknown[][]): number {
  return values
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((row) => row.some((cell) => norm(cell) === "month"));
}

/**
 * Reads the Schedule tab's raw values (unformatted) into a layout plus one
 * ScheduleRow per month row. Throws a sheet-structure error rather than
 * guessing when a header or the Month format is not as expected.
 */
export function parseSchedule(
  values: unknown[][],
  portions: PortionConfig[],
  totalHeader: string,
): { layout: ScheduleLayout; rows: ScheduleRow[] } {
  const headerIndex = findHeaderRowIndex(values);
  if (headerIndex === -1) {
    throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
  }
  const headers = values[headerIndex];
  const monthCol = findColumn(headers, "Month");
  const totalCol = findColumn(headers, totalHeader);

  const portionCols: ScheduleLayout["portionCols"] = {};
  for (const portion of portions) {
    portionCols[portion.id] = {
      tenant: findColumn(headers, portion.tenantHeader),
      count: findColumn(headers, portion.countHeader),
      amount: findColumn(headers, portion.amountHeader),
    };
  }

  const dataRows = values.slice(headerIndex + 1);
  let codec: MonthCodec | null = null;
  for (let i = dataRows.length - 1; i >= 0 && !codec; i--) {
    const cell = dataRows[i][monthCol];
    if (cell === undefined || cell === "") continue;
    try {
      codec = detectMonthCodec(cell);
    } catch {
      // Not a month (for example a footer label). Keep looking upwards.
    }
  }
  if (!codec) {
    throw sheetStructure("The Schedule tab has no month rows to copy the format from.");
  }

  const rows: ScheduleRow[] = [];
  dataRows.forEach((raw, offset) => {
    const month = readMonth(codec, raw[monthCol]);
    if (!month) return;
    const entries: Record<string, PortionEntry | null> = {};
    for (const portion of portions) {
      const cols = portionCols[portion.id];
      const count = raw[cols.count];
      const amount = raw[cols.amount];
      entries[portion.id] =
        typeof count === "number" && typeof amount === "number"
          ? { tenant: String(raw[cols.tenant] ?? "").trim(), count, amount }
          : null;
    }
    rows.push({ rowNumber: headerIndex + 2 + offset, month, entries });
  });

  const lastDataRow = rows.length > 0 ? rows[rows.length - 1].rowNumber : headerIndex + 1;
  return {
    layout: { headerRow: headerIndex + 1, monthCol, totalCol, portionCols, codec, lastDataRow },
    rows,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/sheets/schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sheets/schedule.ts tests/support/fixtures.ts tests/sheets/schedule.test.ts
git commit -m "feat: parse the Schedule tab into portion entries" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Month view derivation

**Files:**
- Create: `src/lib/domain/month-view.ts`
- Test: `tests/domain/month-view.test.ts`

**Interfaces:**
- Consumes: `nextCount`, `startsNewCycle`, `suggestAmount`, `sumAmounts`, `compareYm`, types from Task 2, `parseSchedule` and fixtures (tests only).
- Produces: `findEntryForMonth(rows, portionId, month): PortionEntry | null`, `findPriorEntry(rows, portionId, month): PortionEntry | null`, `nextPayment(prior, portion): NextPayment`, `deriveMonthView(rows, portions, month): MonthView`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/month-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveMonthView, findPriorEntry } from "@/lib/domain/month-view";
import { parseSchedule } from "@/lib/sheets/schedule";
import { baseSchedule, PORTIONS, TOTAL_HEADER } from "../support/fixtures";

const { rows } = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
const card = (view: ReturnType<typeof deriveMonthView>, id: string) =>
  view.cards.find((c) => c.portionId === id)!;

describe("deriveMonthView for a month with no entries yet (Oct-26)", () => {
  const view = deriveMonthView(rows, PORTIONS, { year: 2026, month: 10 });

  it("continues the count inside a cycle with the same rent", () => {
    expect(card(view, "p1")).toMatchObject({
      status: "pending",
      next: { tenant: "Asha", count: 4, suggestedAmount: 5450, startsNewCycle: false },
    });
  });

  it("starts a new cycle with the hike suggestion after payment 11", () => {
    expect(card(view, "p2")).toMatchObject({
      status: "pending",
      next: { count: 1, previousAmount: 12700, suggestedAmount: 13335, startsNewCycle: true },
    });
  });

  it("asks for a tenant when the portion never had one", () => {
    expect(card(view, "p4")).toMatchObject({ status: "needs-tenant", next: null });
  });

  it("totals what is expected and what is received", () => {
    expect(view.received).toBe(0);
    expect(view.paidCount).toBe(0);
    expect(view.expected).toBe(5450 + 13335 + 9000 + 5100);
  });
});

describe("deriveMonthView for a month that is already recorded (Sep-26)", () => {
  const view = deriveMonthView(rows, PORTIONS, { year: 2026, month: 9 });

  it("marks recorded portions paid and derives the count from earlier months", () => {
    expect(card(view, "p1")).toMatchObject({
      status: "paid",
      entry: { tenant: "Asha", count: 3, amount: 5450 },
      next: { count: 3 },
    });
  });

  it("shows a portion that started this month as paid with no earlier history", () => {
    expect(card(view, "p5")).toMatchObject({ status: "paid", next: null });
  });

  it("sums received and expected from recorded amounts", () => {
    expect(view.received).toBe(5450 + 12700 + 9000 + 5100);
    expect(view.expected).toBe(view.received);
    expect(view.paidCount).toBe(4);
  });
});

describe("per-portion cycle settings", () => {
  it("never resets when cycleLength is null", () => {
    const portions = PORTIONS.map((p) => ({ ...p, cycleLength: null }));
    const view = deriveMonthView(rows, portions, { year: 2026, month: 10 });
    expect(card(view, "p2").next).toMatchObject({
      count: 12,
      suggestedAmount: 12700,
      startsNewCycle: false,
    });
  });
});

describe("findPriorEntry", () => {
  it("ignores the selected month and later months", () => {
    expect(findPriorEntry(rows, "p1", { year: 2026, month: 9 })?.count).toBe(2);
    expect(findPriorEntry(rows, "p1", { year: 2026, month: 8 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/month-view.test.ts`
Expected: FAIL, cannot resolve `@/lib/domain/month-view`.

- [ ] **Step 3: Implement**

Create `src/lib/domain/month-view.ts`:

```ts
import { nextCount, startsNewCycle, suggestAmount, sumAmounts } from "./rent-rules";
import type {
  MonthView,
  NextPayment,
  PortionCard,
  PortionConfig,
  PortionEntry,
  ScheduleRow,
  YearMonth,
} from "./types";
import { compareYm } from "./year-month";

/** The entry saved for this month, if any. If a month appears twice, the lower row wins. */
export function findEntryForMonth(
  rows: ScheduleRow[],
  portionId: string,
  month: YearMonth,
): PortionEntry | null {
  const matches = rows.filter(
    (row) => compareYm(row.month, month) === 0 && row.entries[portionId],
  );
  return matches.length > 0 ? matches[matches.length - 1].entries[portionId] : null;
}

/** The most recent entry from a month strictly before `month`. */
export function findPriorEntry(
  rows: ScheduleRow[],
  portionId: string,
  month: YearMonth,
): PortionEntry | null {
  let best: ScheduleRow | null = null;
  for (const row of rows) {
    if (compareYm(row.month, month) >= 0 || !row.entries[portionId]) continue;
    if (
      !best ||
      compareYm(row.month, best.month) > 0 ||
      (compareYm(row.month, best.month) === 0 && row.rowNumber > best.rowNumber)
    ) {
      best = row;
    }
  }
  return best ? best.entries[portionId] : null;
}

export function nextPayment(
  prior: PortionEntry,
  portion: PortionConfig,
): NextPayment {
  const newCycle = startsNewCycle(prior.count, portion.cycleLength);
  return {
    tenant: prior.tenant,
    count: nextCount(prior.count, portion.cycleLength),
    previousAmount: prior.amount,
    startsNewCycle: newCycle,
    suggestedAmount: suggestAmount(prior.amount, portion.hikePercent, newCycle),
  };
}

export function deriveMonthView(
  rows: ScheduleRow[],
  portions: PortionConfig[],
  month: YearMonth,
): MonthView {
  const cards: PortionCard[] = portions.map((portion) => {
    const entry = findEntryForMonth(rows, portion.id, month);
    const prior = findPriorEntry(rows, portion.id, month);
    const next = prior ? nextPayment(prior, portion) : null;
    return {
      portionId: portion.id,
      name: portion.name,
      cycleLength: portion.cycleLength,
      status: entry ? "paid" : next ? "pending" : "needs-tenant",
      entry,
      next,
    };
  });

  return {
    month,
    cards,
    received: sumAmounts(cards.map((card) => card.entry?.amount)),
    expected: sumAmounts(
      cards.map((card) => card.entry?.amount ?? card.next?.suggestedAmount),
    ),
    paidCount: cards.filter((card) => card.status === "paid").length,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/domain/month-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/month-view.ts tests/domain/month-view.test.ts
git commit -m "feat: derive per-portion cards and month totals" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Settings and Payments Log tabs

**Files:**
- Create: `src/lib/sheets/settings-store.ts`
- Test: `tests/sheets/settings-store.test.ts`

**Interfaces:**
- Consumes: `SheetsGateway`, `findHeaderRowIndex`, `PortionConfig`, `sheetStructure`, `validation`, `FakeGateway`, fixtures.
- Produces: constants `SETTINGS_TAB = "Settings"`, `LOG_TAB = "Payments Log"`, `SETTINGS_HEADERS`, `LOG_HEADERS`, `DEFAULT_PORTION_NAMES`, `DEFAULT_CYCLE_LENGTH = 11`, `DEFAULT_HIKE_PERCENT = 5`; `inferPortions(headerRow): PortionConfig[]`; `ensureTabs(gateway, scheduleTab): Promise<void>` (runs once per gateway instance; creates the two tabs when missing); `readSettings(gateway): Promise<PortionConfig[]>`; type `SettingsUpdate {id, name, cycleLength, hikePercent}`; `updateSettings(gateway, updates): Promise<void>` (validates everything before writing anything).

- [ ] **Step 1: Write the failing test**

Create `tests/sheets/settings-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  ensureTabs,
  inferPortions,
  LOG_HEADERS,
  LOG_TAB,
  readSettings,
  SETTINGS_TAB,
  updateSettings,
} from "@/lib/sheets/settings-store";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, PORTIONS, SCHEDULE_HEADERS } from "../support/fixtures";

describe("inferPortions", () => {
  it("builds five portions with default names, cycle 11 and hike 5", () => {
    const portions = inferPortions(SCHEDULE_HEADERS);
    expect(portions).toHaveLength(5);
    expect(portions[0]).toEqual({
      id: "p1",
      name: "First floor, single bedroom",
      tenantHeader: "Tenant",
      countHeader: "Count",
      amountHeader: "Amount",
      cycleLength: 11,
      hikePercent: 5,
    });
    expect(portions[4]).toMatchObject({ id: "p5", tenantHeader: "Tenant5", amountHeader: "Amount5" });
  });

  it("refuses a Tenant column without Count and Amount after it", () => {
    expect(() => inferPortions(["Month", "Tenant", "Amount", "Count"])).toThrow(AppError);
  });

  it("refuses a header row with no Tenant columns", () => {
    expect(() => inferPortions(["Month", "Total"])).toThrow(/No "Tenant" columns/);
  });
});

describe("ensureTabs", () => {
  it("creates Settings and Payments Log once, seeded from the Schedule header", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    expect([...fake.tabs.keys()]).toEqual(["Schedule", SETTINGS_TAB, LOG_TAB]);
    expect(fake.tabs.get(LOG_TAB)).toEqual([LOG_HEADERS]);
    const portions = await readSettings(fake);
    expect(portions.map((p) => p.tenantHeader)).toEqual(PORTIONS.map((p) => p.tenantHeader));

    const callsBefore = fake.calls.length;
    await ensureTabs(fake, "Schedule");
    expect(fake.calls.length).toBe(callsBefore);
  });

  it("keeps existing Settings and only adds what is missing", async () => {
    const fake = new FakeGateway({
      Schedule: baseSchedule(),
      [SETTINGS_TAB]: [["Portion"], ["p1", "Ground", "Tenant", "Count", "Amount", 6, 8]],
    });
    await ensureTabs(fake, "Schedule");
    expect(fake.tabs.has(LOG_TAB)).toBe(true);
    const portions = await readSettings(fake);
    expect(portions).toHaveLength(1);
    expect(portions[0]).toMatchObject({ name: "Ground", cycleLength: 6, hikePercent: 8 });
  });

  it("fails clearly when the Schedule tab is missing", async () => {
    const fake = new FakeGateway({ Other: [] });
    await expect(ensureTabs(fake, "Schedule")).rejects.toThrow(/tab "Schedule" was not found/);
  });
});

describe("readSettings", () => {
  const withRow = (row: unknown[]) =>
    new FakeGateway({ [SETTINGS_TAB]: [["Portion"], row] });

  it("reads a blank cycle length as never resets", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", "", 5]);
    expect((await readSettings(fake))[0].cycleLength).toBeNull();
  });

  it("rejects a non-integer cycle length instead of guessing", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", 5.5, 5]);
    await expect(readSettings(fake)).rejects.toThrow(/cycle length must be a whole number/);
  });

  it("rejects a negative hike", async () => {
    const fake = withRow(["p1", "Ground", "Tenant", "Count", "Amount", 11, -1]);
    await expect(readSettings(fake)).rejects.toThrow(/hike % must be a number/);
  });
});

describe("updateSettings", () => {
  async function seeded() {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    await ensureTabs(fake, "Schedule");
    return fake;
  }

  it("changes name, cycle length and hike percent only", async () => {
    const fake = await seeded();
    await updateSettings(fake, [
      { id: "p3", name: " Attic ", cycleLength: null, hikePercent: 7.5 },
    ]);
    const portions = await readSettings(fake);
    expect(portions[2]).toMatchObject({
      name: "Attic",
      cycleLength: null,
      hikePercent: 7.5,
      tenantHeader: "Tenant3",
    });
    expect(portions[0].cycleLength).toBe(11);
  });

  it("rejects bad values before writing anything", async () => {
    const fake = await seeded();
    const before = JSON.stringify([...fake.tabs.get(SETTINGS_TAB)!]);
    await expect(
      updateSettings(fake, [
        { id: "p1", name: "Fine", cycleLength: 12, hikePercent: 5 },
        { id: "p2", name: "", cycleLength: 12, hikePercent: 5 },
      ]),
    ).rejects.toThrow(/Portion name/);
    await expect(
      updateSettings(fake, [{ id: "p1", name: "A", cycleLength: 0, hikePercent: 5 }]),
    ).rejects.toThrow(/Cycle length/);
    await expect(
      updateSettings(fake, [{ id: "p1", name: "A", cycleLength: 11, hikePercent: 101 }]),
    ).rejects.toThrow(/Hike/);
    await expect(
      updateSettings(fake, [{ id: "zz", name: "A", cycleLength: 11, hikePercent: 5 }]),
    ).rejects.toThrow(/Unknown portion/);
    expect(JSON.stringify([...fake.tabs.get(SETTINGS_TAB)!])).toBe(before);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sheets/settings-store.test.ts`
Expected: FAIL, cannot resolve `@/lib/sheets/settings-store`.

- [ ] **Step 3: Implement**

Create `src/lib/sheets/settings-store.ts`:

```ts
import type { PortionConfig } from "@/lib/domain/types";
import { sheetStructure, validation } from "@/lib/errors";
import { findHeaderRowIndex } from "./schedule";
import type { SheetsGateway } from "./gateway";

export const SETTINGS_TAB = "Settings";
export const LOG_TAB = "Payments Log";

export const SETTINGS_HEADERS = [
  "Portion",
  "Name",
  "Tenant header",
  "Count header",
  "Amount header",
  "Cycle length",
  "Hike %",
];

export const LOG_HEADERS = [
  "Saved at",
  "Month",
  "Portion",
  "Tenant",
  "Amount",
  "Count",
  "Date received",
];

export const DEFAULT_PORTION_NAMES = [
  "First floor, single bedroom",
  "First floor, double bedroom",
  "Second floor, single bedroom",
  "Second floor, double bedroom",
  "Third floor, hall and kitchen",
];

export const DEFAULT_CYCLE_LENGTH = 11;
export const DEFAULT_HIKE_PERCENT = 5;

const TENANT_HEADER = /^tenant\d*$/i;
const COUNT_HEADER = /^count\d*$/i;
const AMOUNT_HEADER = /^amount\d*$/i;

/**
 * Builds default portion settings from the Schedule header row: every
 * "Tenant*" header must be followed by a "Count*" and an "Amount*" header.
 */
export function inferPortions(headerRow: unknown[]): PortionConfig[] {
  const cells = headerRow.map((cell) => String(cell ?? "").trim());
  const portions: PortionConfig[] = [];
  cells.forEach((header, index) => {
    if (!TENANT_HEADER.test(header)) return;
    const count = cells[index + 1] ?? "";
    const amount = cells[index + 2] ?? "";
    if (!COUNT_HEADER.test(count) || !AMOUNT_HEADER.test(amount)) {
      throw sheetStructure(
        `"${header}" must be followed by a Count and an Amount column in the Schedule tab.`,
      );
    }
    const position = portions.length;
    portions.push({
      id: `p${position + 1}`,
      name: DEFAULT_PORTION_NAMES[position] ?? `Portion ${position + 1}`,
      tenantHeader: header,
      countHeader: count,
      amountHeader: amount,
      cycleLength: DEFAULT_CYCLE_LENGTH,
      hikePercent: DEFAULT_HIKE_PERCENT,
    });
  });
  if (portions.length === 0) {
    throw sheetStructure('No "Tenant" columns were found in the Schedule header row.');
  }
  return portions;
}

const toSettingsRow = (p: PortionConfig) => [
  p.id,
  p.name,
  p.tenantHeader,
  p.countHeader,
  p.amountHeader,
  p.cycleLength ?? "",
  p.hikePercent,
];

const bootstrapped = new WeakSet<SheetsGateway>();

/**
 * Creates the Settings and Payments Log tabs when they are missing. Settings
 * is seeded from the Schedule header row. Runs once per gateway instance.
 */
export async function ensureTabs(gateway: SheetsGateway, scheduleTab: string): Promise<void> {
  if (bootstrapped.has(gateway)) return;
  const tabs = await gateway.listTabs();
  if (!tabs.includes(scheduleTab)) {
    throw sheetStructure(`The tab "${scheduleTab}" was not found in the Google Sheet.`);
  }
  if (!tabs.includes(SETTINGS_TAB)) {
    const top = await gateway.getValues(scheduleTab, "A1:ZZ25", "FORMATTED_VALUE");
    const headerIndex = findHeaderRowIndex(top);
    if (headerIndex === -1) {
      throw sheetStructure('No header row containing "Month" was found in the Schedule tab.');
    }
    const portions = inferPortions(top[headerIndex]);
    await gateway.addTab(SETTINGS_TAB);
    await gateway.updateValues([
      {
        tab: SETTINGS_TAB,
        a1: "A1",
        values: [SETTINGS_HEADERS, ...portions.map(toSettingsRow)],
      },
    ]);
  }
  if (!tabs.includes(LOG_TAB)) {
    await gateway.addTab(LOG_TAB);
    await gateway.updateValues([{ tab: LOG_TAB, a1: "A1", values: [LOG_HEADERS] }]);
  }
  bootstrapped.add(gateway);
}

export async function readSettings(gateway: SheetsGateway): Promise<PortionConfig[]> {
  const values = await gateway.getValues(SETTINGS_TAB, "A1:G50", "UNFORMATTED_VALUE");
  const portions: PortionConfig[] = [];
  values.slice(1).forEach((row, offset) => {
    if (row.length === 0 || row[0] === undefined || row[0] === "") return;
    const sheetRow = offset + 2;
    const cycle = row[5];
    const hike = row[6];
    if (cycle !== undefined && cycle !== "" && !(Number.isInteger(cycle) && (cycle as number) >= 1)) {
      throw sheetStructure(
        `Settings row ${sheetRow}: cycle length must be a whole number, or blank for "never resets".`,
      );
    }
    if (hike !== undefined && hike !== "" && !(typeof hike === "number" && hike >= 0)) {
      throw sheetStructure(`Settings row ${sheetRow}: hike % must be a number, 0 or more.`);
    }
    portions.push({
      id: String(row[0]),
      name: String(row[1] ?? row[0]),
      tenantHeader: String(row[2] ?? ""),
      countHeader: String(row[3] ?? ""),
      amountHeader: String(row[4] ?? ""),
      cycleLength: typeof cycle === "number" ? cycle : null,
      hikePercent: typeof hike === "number" ? hike : DEFAULT_HIKE_PERCENT,
    });
  });
  if (portions.length === 0) {
    throw sheetStructure("The Settings tab has no portions.");
  }
  return portions;
}

export type SettingsUpdate = {
  id: string;
  name: string;
  cycleLength: number | null;
  hikePercent: number;
};

/** Updates name, cycle length and hike % only. Header mapping is never edited here. */
export async function updateSettings(
  gateway: SheetsGateway,
  updates: SettingsUpdate[],
): Promise<void> {
  const current = await readSettings(gateway);
  const writes = updates.map((update) => {
    const index = current.findIndex((p) => p.id === update.id);
    if (index === -1) throw validation(`Unknown portion "${update.id}".`);
    const name = update.name.trim();
    if (name.length === 0 || name.length > 60) {
      throw validation("Portion name must be 1 to 60 characters.");
    }
    if (
      update.cycleLength !== null &&
      !(Number.isInteger(update.cycleLength) && update.cycleLength >= 1 && update.cycleLength <= 120)
    ) {
      throw validation("Cycle length must be a whole number from 1 to 120, or blank.");
    }
    if (!(Number.isFinite(update.hikePercent) && update.hikePercent >= 0 && update.hikePercent <= 100)) {
      throw validation("Hike % must be between 0 and 100.");
    }
    const row = index + 2;
    return [
      { tab: SETTINGS_TAB, a1: `B${row}`, values: [[name]] },
      {
        tab: SETTINGS_TAB,
        a1: `F${row}:G${row}`,
        values: [[update.cycleLength ?? "", update.hikePercent]],
      },
    ];
  });
  await gateway.updateValues(writes.flat());
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/sheets/settings-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sheets/settings-store.ts tests/sheets/settings-store.test.ts
git commit -m "feat: add Settings and Payments Log tab bootstrap and settings store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The Sheets service (month view, log payment, settings)

**Files:**
- Create: `src/lib/sheets/service.ts`
- Test: `tests/sheets/service.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 8.
- Produces: type `SheetsContext {gateway, scheduleTab, totalHeader}`; `getMonthView(ctx, month): Promise<MonthView>`; `getSettings(ctx): Promise<PortionConfig[]>`; `saveSettings(ctx, updates): Promise<PortionConfig[]>`; type `LogPaymentInput {month, portionId, amount, dateReceived, newTenantName?, overwrite?}`; type `LogRow` (7-tuple: saved-at ISO, month key, portion name, tenant, amount, count, date received); type `LogPaymentResult {entry, logWritten, logRow}`; `logPayment(ctx, input, { now, retryDelayMs? }): Promise<LogPaymentResult>`; `retryLogRow(ctx, row, retryDelayMs?): Promise<boolean>`.
- Behavior to preserve: validation happens before any Sheet call; a duplicate month entry throws `conflict` with `details {existingAmount, existingTenant}` unless `overwrite`; a new tenant gets count 1; a portion with no history needs `newTenantName`; the new month row is cloned atomically from the last month row; the total cell is written only when it is not a formula.

- [ ] **Step 1: Write the failing test**

Create `tests/sheets/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serialFromYm } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { LOG_TAB } from "@/lib/sheets/settings-store";
import {
  getMonthView,
  logPayment,
  retryLogRow,
  type LogPaymentInput,
  type SheetsContext,
} from "@/lib/sheets/service";
import { cell, FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

const NOW = new Date("2026-10-05T04:30:00Z");
const OCT = { year: 2026, month: 10 };

function setup(schedule: unknown[][] = baseSchedule()) {
  const fake = new FakeGateway({ Schedule: schedule });
  const ctx: SheetsContext = { gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER };
  return { fake, ctx };
}

const pay = (ctx: SheetsContext, input: Partial<LogPaymentInput> & { portionId: string }) =>
  logPayment(
    ctx,
    { month: OCT, amount: 5450, dateReceived: "2026-10-05", ...input },
    { now: NOW, retryDelayMs: 0 },
  );

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

describe("getMonthView", () => {
  it("creates the Settings and Payments Log tabs on first use and derives cards", async () => {
    const { fake, ctx } = setup();
    const view = await getMonthView(ctx, OCT);
    expect([...fake.tabs.keys()]).toContain("Settings");
    expect([...fake.tabs.keys()]).toContain(LOG_TAB);
    expect(view.cards[0]).toMatchObject({ status: "pending", next: { count: 4 } });
  });
});

describe("logPayment: first payment of a new month", () => {
  it("clones the last month row, blanks the inputs, and writes only this portion", async () => {
    const { fake, ctx } = setup();
    const result = await pay(ctx, { portionId: "p1" });

    expect(result).toMatchObject({
      entry: { tenant: "Asha", count: 4, amount: 5450 },
      logWritten: true,
    });
    expect(cell(fake, "Schedule", "A", 6)).toBe("Oct-26");
    expect(cell(fake, "Schedule", "B", 6)).toBe("Asha");
    expect(cell(fake, "Schedule", "C", 6)).toBe(4);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(cell(fake, "Schedule", "E", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "G", 6)).toBeUndefined();
    expect(cell(fake, "Schedule", "Q", 6)).toBe("=D6+G6+J6+M6+P6");
    expect(cell(fake, "Schedule", "D", 5)).toBe(5450);
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
  });

  it("writes a Payments Log row with the date received", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1", dateReceived: "2026-10-03" });
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1]).toEqual([
      "2026-10-05T04:30:00.000Z",
      "2026-10",
      "First floor, single bedroom",
      "Asha",
      5450,
      4,
      "2026-10-03",
    ]);
  });

  it("writes a real date serial when the Month column holds dates", async () => {
    const { fake, ctx } = setup(baseSchedule("serial"));
    await pay(ctx, { portionId: "p1" });
    expect(cell(fake, "Schedule", "A", 6)).toBe(serialFromYm(OCT));
  });
});

describe("logPayment: later payments in the same month", () => {
  it("reuses the month row and accepts an edited amount after a cycle wrap", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const result = await pay(ctx, { portionId: "p2", amount: 13300 });

    expect(result.entry).toEqual({ tenant: "Bala", count: 1, amount: 13300 });
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
    expect(cell(fake, "Schedule", "F", 6)).toBe(1);
    expect(cell(fake, "Schedule", "G", 6)).toBe(13300);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
  });

  it("refreshes the month view after saving", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const view = await getMonthView(ctx, OCT);
    expect(view.cards[0]).toMatchObject({ status: "paid", entry: { count: 4 } });
    expect(view.paidCount).toBe(1);
  });
});

describe("logPayment: duplicates", () => {
  it("refuses to replace an amount without confirmation", async () => {
    const { ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const error = await expectCode(pay(ctx, { portionId: "p1", amount: 6000 }), "conflict");
    expect(error.details).toEqual({ existingAmount: 5450, existingTenant: "Asha" });
  });

  it("overwrites when confirmed, keeping the same count", async () => {
    const { fake, ctx } = setup();
    await pay(ctx, { portionId: "p1" });
    const result = await pay(ctx, { portionId: "p1", amount: 6000, overwrite: true });
    expect(result.entry).toEqual({ tenant: "Asha", count: 4, amount: 6000 });
    expect(cell(fake, "Schedule", "C", 6)).toBe(4);
    expect(cell(fake, "Schedule", "D", 6)).toBe(6000);
  });
});

describe("logPayment: tenants", () => {
  it("requires a tenant name for a portion with no history", async () => {
    const { ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p4" }), "validation");
  });

  it("starts a new tenant at count 1 with the typed rent", async () => {
    const { fake, ctx } = setup();
    const result = await pay(ctx, { portionId: "p4", amount: 8000, newTenantName: " Farah " });
    expect(result.entry).toEqual({ tenant: "Farah", count: 1, amount: 8000 });
    expect(cell(fake, "Schedule", "K", 6)).toBe("Farah");
    expect(cell(fake, "Schedule", "L", 6)).toBe(1);
  });

  it("restarts the count for a new tenant even mid-cycle", async () => {
    const { ctx } = setup();
    const result = await pay(ctx, { portionId: "p3", amount: 9500, newTenantName: "Gita" });
    expect(result.entry).toMatchObject({ tenant: "Gita", count: 1 });
  });

  it("keeps counting when the cycle never resets", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    const settings = fake.tabs.get("Settings")!;
    settings[2][5] = "";
    const result = await pay(ctx, { portionId: "p2", amount: 12700 });
    expect(result.entry.count).toBe(12);
  });
});

describe("logPayment: total column without a formula", () => {
  function plainTotals() {
    const schedule = baseSchedule();
    (schedule[3] as unknown[])[16] = 31350;
    (schedule[4] as unknown[])[16] = 31350;
    return schedule;
  }

  it("blanks the copied total and then keeps it equal to the sum of the row", async () => {
    const { fake, ctx } = setup(plainTotals());
    await pay(ctx, { portionId: "p1" });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(5450);
    await pay(ctx, { portionId: "p2", amount: 13300 });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(18750);
  });

  it("recomputes the total after an overwrite", async () => {
    const { fake, ctx } = setup(plainTotals());
    await pay(ctx, { portionId: "p1" });
    await pay(ctx, { portionId: "p2", amount: 13300 });
    await pay(ctx, { portionId: "p1", amount: 6000, overwrite: true });
    expect(cell(fake, "Schedule", "Q", 6)).toBe(19300);
  });
});

describe("logPayment: sheet safety", () => {
  it("stops when the row under the table is not empty and changes nothing", async () => {
    const schedule = baseSchedule();
    schedule.push(["Notes: remember to renew insurance"]);
    const { fake, ctx } = setup(schedule);
    await expectCode(pay(ctx, { portionId: "p1" }), "conflict");
    expect(fake.tabs.get("Schedule")).toHaveLength(6);
    expect(cell(fake, "Schedule", "A", 6)).toBe("Notes: remember to renew insurance");
  });

  it("surfaces a header renamed after setup instead of guessing", async () => {
    const { fake, ctx } = setup();
    await getMonthView(ctx, OCT);
    (fake.tabs.get("Schedule")![2] as string[])[2] = "Cnt";
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "sheet-structure");
    expect(error.message).toMatch(/Header "Count" was not found/);
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
  });

  it("rejects a broken header on first run while seeding Settings", async () => {
    const schedule = baseSchedule();
    (schedule[2] as string[])[2] = "Cnt";
    const { ctx } = setup(schedule);
    const error = await expectCode(pay(ctx, { portionId: "p1" }), "sheet-structure");
    expect(error.message).toMatch(/must be followed by a Count and an Amount/);
  });
});

describe("logPayment: Payments Log failures", () => {
  it("keeps the Schedule write and reports the log as pending", async () => {
    const { fake, ctx } = setup();
    fake.failOn.add("appendRow");
    const result = await pay(ctx, { portionId: "p1" });
    expect(result.logWritten).toBe(false);
    expect(cell(fake, "Schedule", "D", 6)).toBe(5450);
    expect(fake.calls.filter((c) => c === "appendRow")).toHaveLength(3);

    fake.failOn.clear();
    expect(await retryLogRow(ctx, result.logRow, 0)).toBe(true);
    const log = fake.tabs.get(LOG_TAB)!;
    expect(log[log.length - 1]).toEqual(result.logRow);
  });
});

describe("logPayment: input validation", () => {
  it.each([0, -5, 12.5, Number.NaN, 20_000_000])("rejects amount %s", async (amount) => {
    const { ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", amount }), "validation");
  });

  it("rejects an impossible date, an empty tenant name, and an unknown portion", async () => {
    const { ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", dateReceived: "2026-02-30" }), "validation");
    await expectCode(pay(ctx, { portionId: "p4", newTenantName: "  " }), "validation");
    await expectCode(pay(ctx, { portionId: "p9" }), "validation");
  });

  it("does not touch the sheet when validation fails", async () => {
    const { fake, ctx } = setup();
    await expectCode(pay(ctx, { portionId: "p1", amount: 0 }), "validation");
    expect(fake.tabs.get("Schedule")).toHaveLength(5);
    expect(fake.tabs.has("Settings")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sheets/service.test.ts`
Expected: FAIL, cannot resolve `@/lib/sheets/service`.

- [ ] **Step 3: Implement**

Create `src/lib/sheets/service.ts`:

```ts
import { writeMonth } from "@/lib/domain/month-codec";
import {
  deriveMonthView,
  findEntryForMonth,
  findPriorEntry,
} from "@/lib/domain/month-view";
import { nextCount, sumAmounts } from "@/lib/domain/rent-rules";
import type {
  MonthView,
  PortionConfig,
  PortionEntry,
  ScheduleRow,
  YearMonth,
} from "@/lib/domain/types";
import { compareYm, isValidIsoDay, ymKey } from "@/lib/domain/year-month";
import { conflict, validation } from "@/lib/errors";
import { colLetter } from "./a1";
import type { SheetsGateway } from "./gateway";
import { parseSchedule, type ScheduleLayout } from "./schedule";
import {
  ensureTabs,
  LOG_TAB,
  readSettings,
  updateSettings,
  type SettingsUpdate,
} from "./settings-store";

export type SheetsContext = {
  gateway: SheetsGateway;
  scheduleTab: string;
  totalHeader: string;
};

type Loaded = {
  portions: PortionConfig[];
  layout: ScheduleLayout;
  rows: ScheduleRow[];
};

async function load(ctx: SheetsContext): Promise<Loaded> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  const portions = await readSettings(ctx.gateway);
  const values = await ctx.gateway.getValues(ctx.scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE");
  return { portions, ...parseSchedule(values, portions, ctx.totalHeader) };
}

export async function getMonthView(ctx: SheetsContext, month: YearMonth): Promise<MonthView> {
  const { portions, rows } = await load(ctx);
  return deriveMonthView(rows, portions, month);
}

export async function getSettings(ctx: SheetsContext): Promise<PortionConfig[]> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  return readSettings(ctx.gateway);
}

export async function saveSettings(
  ctx: SheetsContext,
  updates: SettingsUpdate[],
): Promise<PortionConfig[]> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  await updateSettings(ctx.gateway, updates);
  return readSettings(ctx.gateway);
}

async function totalIsFormula(ctx: SheetsContext, layout: ScheduleLayout): Promise<boolean> {
  const a1 = `${colLetter(layout.totalCol)}${layout.lastDataRow}`;
  const cells = await ctx.gateway.getValues(ctx.scheduleTab, a1, "FORMULA");
  const value = cells[0]?.[0];
  return typeof value === "string" && value.startsWith("=");
}

/**
 * Returns the sheet row for `month`, creating it below the last month row when
 * missing. The new row is cloned from the last month row (so formatting and
 * the total formula carry over) with every payment cell blanked.
 */
async function ensureMonthRow(
  ctx: SheetsContext,
  loaded: Loaded,
  month: YearMonth,
  totalHasFormula: boolean,
): Promise<number> {
  const existing = loaded.rows.filter((row) => compareYm(row.month, month) === 0);
  if (existing.length > 0) return existing[existing.length - 1].rowNumber;

  const { layout, portions } = loaded;
  const newRow = layout.lastDataRow + 1;
  const below = await ctx.gateway.getValues(ctx.scheduleTab, `A${newRow}:ZZ${newRow}`, "FORMULA");
  const occupied = below.some((row) => row.some((cell) => cell !== undefined && cell !== ""));
  if (occupied) {
    throw conflict(
      `Row ${newRow} of the Schedule tab is below the last month but not empty, so a new month row cannot be added there.`,
    );
  }

  const clearCols = portions.flatMap((p) => {
    const cols = layout.portionCols[p.id];
    return [cols.tenant, cols.count, cols.amount];
  });
  if (!totalHasFormula) clearCols.push(layout.totalCol);

  await ctx.gateway.cloneRow(ctx.scheduleTab, layout.lastDataRow, newRow, clearCols, [
    { col: layout.monthCol, value: writeMonth(layout.codec, month) },
  ]);
  return newRow;
}

export type LogPaymentInput = {
  month: YearMonth;
  portionId: string;
  amount: number;
  /** YYYY-MM-DD */
  dateReceived: string;
  /** Set when a new tenant moves in: count restarts at 1. */
  newTenantName?: string;
  /** Replace an amount that is already recorded for this month. */
  overwrite?: boolean;
};

export type LogRow = [string, string, string, string, number, number, string];

export type LogPaymentResult = {
  entry: PortionEntry;
  /** False when the Schedule was saved but the Payments Log row could not be written. */
  logWritten: boolean;
  logRow: LogRow;
};

export type LogPaymentOptions = {
  now: Date;
  retryDelayMs?: number;
};

const MAX_AMOUNT = 10_000_000;

function validateInput(input: LogPaymentInput): string | undefined {
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_AMOUNT) {
    throw validation("Amount must be a whole number of rupees, more than 0.");
  }
  if (!isValidIsoDay(input.dateReceived)) {
    throw validation("Date received must be a real date.");
  }
  if (input.newTenantName === undefined) return undefined;
  const name = input.newTenantName.trim();
  if (name.length === 0 || name.length > 60) {
    throw validation("Tenant name must be 1 to 60 characters.");
  }
  return name;
}

export async function logPayment(
  ctx: SheetsContext,
  input: LogPaymentInput,
  options: LogPaymentOptions,
): Promise<LogPaymentResult> {
  const newTenant = validateInput(input);
  const loaded = await load(ctx);
  const portion = loaded.portions.find((p) => p.id === input.portionId);
  if (!portion) throw validation(`Unknown portion "${input.portionId}".`);

  const existing = findEntryForMonth(loaded.rows, portion.id, input.month);
  if (existing && !input.overwrite) {
    throw conflict(
      `${portion.name} already has ₹${existing.amount} recorded for ${ymKey(input.month)}.`,
      { existingAmount: existing.amount, existingTenant: existing.tenant },
    );
  }

  const prior = findPriorEntry(loaded.rows, portion.id, input.month);
  let tenant: string;
  let count: number;
  if (newTenant !== undefined) {
    tenant = newTenant;
    count = 1;
  } else if (prior) {
    tenant = prior.tenant;
    count = nextCount(prior.count, portion.cycleLength);
  } else {
    throw validation("This portion has no tenant yet. Enter a tenant name.");
  }

  const totalHasFormula = await totalIsFormula(ctx, loaded.layout);
  const rowNumber = await ensureMonthRow(ctx, loaded, input.month, totalHasFormula);
  const cols = loaded.layout.portionCols[portion.id];
  const at = (col: number) => `${colLetter(col)}${rowNumber}`;

  const writes = [
    { tab: ctx.scheduleTab, a1: at(cols.tenant), values: [[tenant]] },
    { tab: ctx.scheduleTab, a1: at(cols.count), values: [[count]] },
    { tab: ctx.scheduleTab, a1: at(cols.amount), values: [[input.amount]] },
  ];
  if (!totalHasFormula) {
    const monthRow = loaded.rows.find((row) => row.rowNumber === rowNumber);
    const others = loaded.portions
      .filter((p) => p.id !== portion.id)
      .map((p) => monthRow?.entries[p.id]?.amount);
    writes.push({
      tab: ctx.scheduleTab,
      a1: at(loaded.layout.totalCol),
      values: [[sumAmounts(others) + input.amount]],
    });
  }
  await ctx.gateway.updateValues(writes);

  const logRow: LogRow = [
    options.now.toISOString(),
    ymKey(input.month),
    portion.name,
    tenant,
    input.amount,
    count,
    input.dateReceived,
  ];
  const logWritten = await appendLogRow(ctx.gateway, logRow, options.retryDelayMs ?? 400);
  return { entry: { tenant, count, amount: input.amount }, logWritten, logRow };
}

const LOG_ATTEMPTS = 3;

async function appendLogRow(
  gateway: SheetsGateway,
  row: LogRow,
  retryDelayMs: number,
): Promise<boolean> {
  for (let attempt = 1; attempt <= LOG_ATTEMPTS; attempt++) {
    try {
      await gateway.appendRow(LOG_TAB, row);
      return true;
    } catch {
      if (attempt < LOG_ATTEMPTS && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }
  return false;
}

/** Second chance for a Payments Log row that failed after the Schedule was saved. */
export async function retryLogRow(
  ctx: SheetsContext,
  row: LogRow,
  retryDelayMs = 400,
): Promise<boolean> {
  await ensureTabs(ctx.gateway, ctx.scheduleTab);
  return appendLogRow(ctx.gateway, row, retryDelayMs);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/sheets/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass; typecheck is clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sheets/service.ts tests/sheets/service.test.ts
git commit -m "feat: add month view and log-payment service" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The real Google gateway

**Files:**
- Create: `src/lib/sheets/google-errors.ts`, `src/lib/sheets/google-gateway.ts`
- Test: `tests/sheets/google-errors.test.ts`, `tests/sheets/google-gateway.test.ts`

**Interfaces:**
- Consumes: `SheetsGateway`, `AppError`, `configError`.
- Produces: `translateGoogleError(error, serviceAccountEmail?): unknown`; class `GoogleSheetsGateway implements SheetsGateway` with `static fromServiceAccount(serviceAccountJson, spreadsheetId)`.
- Note: these unit tests use a mock of the Google client. They check the requests RentBook builds (RAW writes, quoted tab names, one atomic batch for a new month row). They cannot prove Google accepts them; Task 12 and Task 18 do that against a real Sheet.

- [ ] **Step 1: Write the failing tests**

Create `tests/sheets/google-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError, validation } from "@/lib/errors";
import { translateGoogleError } from "@/lib/sheets/google-errors";

const EMAIL = "rentbook@project.iam.gserviceaccount.com";

describe("translateGoogleError", () => {
  it("explains the .xlsx case", () => {
    const error = translateGoogleError(
      { code: 400, message: "This operation is not supported for this document" },
      EMAIL,
    ) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("config");
    expect(error.message).toMatch(/Save as Google Sheets/);
  });

  it("names the service account when access is denied", () => {
    const error = translateGoogleError({ status: 403, message: "forbidden" }, EMAIL) as AppError;
    expect(error.message).toContain(EMAIL);
  });

  it("reads the status from response.status or a string code", () => {
    expect((translateGoogleError({ response: { status: 404 } }) as AppError).message).toMatch(
      /SHEET_ID/,
    );
    expect((translateGoogleError({ code: "429" }) as AppError).message).toMatch(/limiting/);
  });

  it("passes AppErrors and unknown failures through untouched", () => {
    const own = validation("nope");
    expect(translateGoogleError(own)).toBe(own);
    const other = new Error("socket hang up");
    expect(translateGoogleError(other)).toBe(other);
    expect(translateGoogleError("text")).toBe("text");
  });
});
```

Create `tests/sheets/google-gateway.test.ts`:

```ts
import type { sheets_v4 } from "@googleapis/sheets";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";

/** A stand-in for the Google client that records the requests it receives. */
function mockApi(overrides: { rowCount?: number; failWith?: unknown } = {}) {
  const fail = async () => {
    throw overrides.failWith;
  };
  const get = overrides.failWith
    ? fail
    : vi.fn(async () => ({
        data: {
          sheets: [
            { properties: { sheetId: 11, title: "Schedule", gridProperties: { rowCount: overrides.rowCount ?? 1000 } } },
            { properties: { sheetId: 22, title: "Payments Log", gridProperties: { rowCount: 1000 } } },
          ],
        },
      }));
  const valuesGet = vi.fn(async () => ({ data: { values: [["a", 1]] } }));
  const valuesBatchUpdate = vi.fn(async () => ({}));
  const valuesAppend = vi.fn(async () => ({}));
  const batchUpdate = vi.fn(async () => ({}));
  const api = {
    spreadsheets: {
      get,
      batchUpdate,
      values: { get: valuesGet, batchUpdate: valuesBatchUpdate, append: valuesAppend },
    },
  } as unknown as sheets_v4.Sheets;
  return { api, get, valuesGet, valuesBatchUpdate, valuesAppend, batchUpdate };
}

describe("GoogleSheetsGateway", () => {
  it("lists tab titles", async () => {
    const { api } = mockApi();
    expect(await new GoogleSheetsGateway(api, "sheet-id").listTabs()).toEqual([
      "Schedule",
      "Payments Log",
    ]);
  });

  it("quotes tab names with spaces and apostrophes, and asks for serial dates", async () => {
    const { api, valuesGet } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    expect(await gateway.getValues("Payments Log", "A1:ZZ", "UNFORMATTED_VALUE")).toEqual([["a", 1]]);
    expect(valuesGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "'Payments Log'!A1:ZZ",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    await gateway.getValues("Owner's rent", "A1", "FORMULA");
    expect(valuesGet).toHaveBeenLastCalledWith(
      expect.objectContaining({ range: "'Owner''s rent'!A1" }),
    );
  });

  it("writes with RAW so text is never read as a formula", async () => {
    const { api, valuesBatchUpdate, valuesAppend } = mockApi();
    const gateway = new GoogleSheetsGateway(api, "sheet-id");
    await gateway.updateValues([{ tab: "Schedule", a1: "B6", values: [["=HYPERLINK(1)"]] }]);
    expect(valuesBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: {
        valueInputOption: "RAW",
        data: [{ range: "'Schedule'!B6", values: [["=HYPERLINK(1)"]] }],
      },
    });
    await gateway.appendRow("Payments Log", ["x", 1]);
    expect(valuesAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'Payments Log'!A1",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [["x", 1]] },
      }),
    );
  });

  it("skips the API call for an empty write list", async () => {
    const { api, valuesBatchUpdate } = mockApi();
    await new GoogleSheetsGateway(api, "sheet-id").updateValues([]);
    expect(valuesBatchUpdate).not.toHaveBeenCalled();
  });

  it("clones a row in ONE batchUpdate: copy, then clear, then override", async () => {
    const { api, batchUpdate } = mockApi();
    await new GoogleSheetsGateway(api, "sheet-id").cloneRow("Schedule", 5, 6, [1, 2], [
      { col: 0, value: "Oct-26" },
      { col: 3, value: 42 },
    ]);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    const { requests } = (batchUpdate.mock.calls[0] as unknown as [{ requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }])[0].requestBody;
    expect(requests).toHaveLength(5);
    expect(requests![0]).toEqual({
      copyPaste: {
        source: { sheetId: 11, startRowIndex: 4, endRowIndex: 5 },
        destination: { sheetId: 11, startRowIndex: 5, endRowIndex: 6 },
        pasteType: "PASTE_NORMAL",
        pasteOrientation: "NORMAL",
      },
    });
    expect(requests![1]).toEqual({
      updateCells: {
        range: { sheetId: 11, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 2 },
        rows: [{ values: [{}] }],
        fields: "userEnteredValue",
      },
    });
    expect(requests![3].updateCells!.rows![0].values![0]).toEqual({
      userEnteredValue: { stringValue: "Oct-26" },
    });
    expect(requests![4].updateCells!.rows![0].values![0]).toEqual({
      userEnteredValue: { numberValue: 42 },
    });
  });

  it("adds grid rows first when the new row is past the end of the sheet", async () => {
    const { api, batchUpdate } = mockApi({ rowCount: 5 });
    await new GoogleSheetsGateway(api, "sheet-id").cloneRow("Schedule", 5, 6, [], []);
    const { requests } = (batchUpdate.mock.calls[0] as unknown as [{ requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }])[0].requestBody;
    expect(requests![0]).toEqual({
      appendDimension: { sheetId: 11, dimension: "ROWS", length: 1 },
    });
    expect(requests![1].copyPaste).toBeDefined();
  });

  it("explains a missing tab", async () => {
    const { api } = mockApi();
    await expect(
      new GoogleSheetsGateway(api, "sheet-id").cloneRow("Nope", 5, 6, [], []),
    ).rejects.toThrow(/tab "Nope" was not found/);
  });

  it("translates Google errors into actionable messages", async () => {
    const { api } = mockApi({ failWith: { code: 403, message: "The caller does not have permission" } });
    const gateway = new GoogleSheetsGateway(api, "sheet-id", "bot@proj.iam.gserviceaccount.com");
    const error = await gateway.listTabs().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toContain("bot@proj.iam.gserviceaccount.com");
  });

  it("rejects a service account key that is not JSON", () => {
    expect(() => GoogleSheetsGateway.fromServiceAccount("{oops", "id")).toThrow(/not valid JSON/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/sheets/google-errors.test.ts tests/sheets/google-gateway.test.ts`
Expected: FAIL, cannot resolve the two new modules.

- [ ] **Step 3: Implement the error translator**

Create `src/lib/sheets/google-errors.ts`:

```ts
import { AppError, configError } from "@/lib/errors";

type GoogleLikeError = {
  status?: number | string;
  code?: number | string;
  message?: string;
  response?: { status?: number };
};

/**
 * Turns a Google API failure into a message the owner can act on. Errors that
 * are already AppErrors, and anything unrecognised, pass through unchanged.
 */
export function translateGoogleError(error: unknown, serviceAccountEmail?: string): unknown {
  if (error instanceof AppError || typeof error !== "object" || error === null) return error;
  const e = error as GoogleLikeError;
  const status = Number(e.status ?? e.response?.status ?? e.code);
  const message = e.message ?? "";

  if (status === 400 && /not supported for this document/i.test(message)) {
    return configError(
      "This file is an Excel (.xlsx) file, not a Google Sheet. In Google Drive open it, choose File, Save as Google Sheets, then use the new file's ID as SHEET_ID.",
    );
  }
  if (status === 403) {
    return configError(
      serviceAccountEmail
        ? `Google denied access. Share the Sheet with ${serviceAccountEmail} as Editor.`
        : "Google denied access. Share the Sheet with the service account as Editor.",
    );
  }
  if (status === 404) {
    return configError("Google could not find that Sheet. Check SHEET_ID.");
  }
  if (status === 429) {
    return configError("Google is limiting requests right now. Wait a minute and try again.");
  }
  return error;
}
```

- [ ] **Step 4: Implement the gateway**

Create `src/lib/sheets/google-gateway.ts`:

```ts
import { auth as googleAuth, sheets as createSheets, type sheets_v4 } from "@googleapis/sheets";
import { configError } from "@/lib/errors";
import type { CellWrite, RowOverride, SheetsGateway, ValueRender } from "./gateway";
import { translateGoogleError } from "./google-errors";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

type SheetProps = { sheetId: number; title: string; rowCount: number };

function extendedValue(value: string | number): sheets_v4.Schema$ExtendedValue {
  return typeof value === "number" ? { numberValue: value } : { stringValue: value };
}

export class GoogleSheetsGateway implements SheetsGateway {
  constructor(
    private readonly api: sheets_v4.Sheets,
    private readonly spreadsheetId: string,
    private readonly serviceAccountEmail?: string,
  ) {}

  static fromServiceAccount(serviceAccountJson: string, spreadsheetId: string) {
    let credentials: { client_email?: string };
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch {
      throw configError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    const authClient = new googleAuth.GoogleAuth({ credentials, scopes: [SCOPE] });
    return new GoogleSheetsGateway(
      createSheets({ version: "v4", auth: authClient }),
      spreadsheetId,
      credentials.client_email,
    );
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw translateGoogleError(error, this.serviceAccountEmail);
    }
  }

  private async sheetProps(): Promise<SheetProps[]> {
    const { data } = await this.call(() =>
      this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties(sheetId,title,gridProperties.rowCount)",
      }),
    );
    return (data.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? "",
      rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
    }));
  }

  async listTabs() {
    return (await this.sheetProps()).map((sheet) => sheet.title);
  }

  async addTab(title: string) {
    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      }),
    );
  }

  async getValues(tab: string, a1: string, render: ValueRender) {
    const { data } = await this.call(() =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${quote(tab)}!${a1}`,
        valueRenderOption: render,
        dateTimeRenderOption: "SERIAL_NUMBER",
      }),
    );
    return (data.values ?? []) as unknown[][];
  }

  async updateValues(writes: CellWrite[]) {
    if (writes.length === 0) return;
    await this.call(() =>
      this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: writes.map((write) => ({
            range: `${quote(write.tab)}!${write.a1}`,
            values: write.values,
          })),
        },
      }),
    );
  }

  async appendRow(tab: string, row: unknown[]) {
    await this.call(() =>
      this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${quote(tab)}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      }),
    );
  }

  async cloneRow(
    tab: string,
    fromRow: number,
    toRow: number,
    clearCols: number[],
    overrides: RowOverride[],
  ) {
    const props = (await this.sheetProps()).find((sheet) => sheet.title === tab);
    if (!props) throw configError(`The tab "${tab}" was not found in the Google Sheet.`);
    const { sheetId } = props;

    const rowRange = (row: number) => ({
      sheetId,
      startRowIndex: row - 1,
      endRowIndex: row,
    });
    const cellRange = (col: number) => ({
      ...rowRange(toRow),
      startColumnIndex: col,
      endColumnIndex: col + 1,
    });

    const requests: sheets_v4.Schema$Request[] = [];
    if (toRow > props.rowCount) {
      requests.push({
        appendDimension: { sheetId, dimension: "ROWS", length: toRow - props.rowCount },
      });
    }
    requests.push({
      copyPaste: {
        source: rowRange(fromRow),
        destination: rowRange(toRow),
        pasteType: "PASTE_NORMAL",
        pasteOrientation: "NORMAL",
      },
    });
    for (const col of clearCols) {
      requests.push({
        updateCells: { range: cellRange(col), rows: [{ values: [{}] }], fields: "userEnteredValue" },
      });
    }
    for (const { col, value } of overrides) {
      requests.push({
        updateCells: {
          range: cellRange(col),
          rows: [{ values: [{ userEnteredValue: extendedValue(value) }] }],
          fields: "userEnteredValue",
        },
      });
    }

    await this.call(() =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests },
      }),
    );
  }
}
```

- [ ] **Step 5: Run the tests, then typecheck and lint**

Run: `npx vitest run tests/sheets && npm run typecheck && npm run lint`
Expected: all pass. If `@googleapis/sheets` types complain, check the installed version's exports (`sheets`, `auth`, `sheets_v4`) before changing code.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sheets/google-errors.ts src/lib/sheets/google-gateway.ts tests/sheets/google-errors.test.ts tests/sheets/google-gateway.test.ts
git commit -m "feat: add Google Sheets gateway with friendly error messages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: One-time Google setup guide (`SETUP.md`)

**Files:**
- Create: `SETUP.md`

This task is mostly owner actions. Write the file first, then follow it through step 6 to get a working `.env.local` for local runs. Google Cloud menu names change now and then; if a label differs, look for the closest match.

- [ ] **Step 1: Create `SETUP.md`**

````markdown
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
````

- [ ] **Step 2: Owner: complete steps 1 to 6 of the guide**

Done when `.env.local` exists with all values, the test copy is shared with the service account, and `git status` does not list `.env.local`.

- [ ] **Step 3: Commit the guide**

```bash
git add SETUP.md
git commit -m "docs: add one-time Google and Vercel setup guide" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Environment checks and the read-only Sheet recon

**Files:**
- Create: `src/lib/server/env.ts`, `src/lib/sheets/recon.ts`, `scripts/recon.ts`
- Test: `tests/server/env.test.ts`, `tests/sheets/recon.test.ts`

**Interfaces:**
- Produces (`env.ts`): type `AppEnv`; `readEnv(env): AppEnv` (throws `config` error listing every missing variable of `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID`, `TOTAL_HEADER`, `ALLOWED_EMAIL`; `SCHEDULE_TAB` defaults to `Schedule`); `isAllowedEmail(email, allowedEmail, emailVerified?)`.
- Produces (`recon.ts`): type `ReconReport`; `describeSheet(gateway, scheduleTab, totalHeader): Promise<ReconReport>`. It never writes and never creates tabs.

- [ ] **Step 1: Write the failing tests**

Create `tests/server/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedEmail, readEnv } from "@/lib/server/env";

describe("readEnv", () => {
  const base = {
    GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
    SHEET_ID: "abc",
    TOTAL_HEADER: "Per Month",
    ALLOWED_EMAIL: "Me@Example.com",
  };

  it("reads required values and applies defaults", () => {
    expect(readEnv(base)).toMatchObject({
      sheetId: "abc",
      scheduleTab: "Schedule",
      totalHeader: "Per Month",
      allowedEmail: "me@example.com",
    });
    expect(readEnv({ ...base, SCHEDULE_TAB: "Rent" }).scheduleTab).toBe("Rent");
  });

  it("lists every missing variable together", () => {
    expect(() => readEnv({ SHEET_ID: "abc" })).toThrow(
      "Missing environment variables: GOOGLE_SERVICE_ACCOUNT_JSON, TOTAL_HEADER, ALLOWED_EMAIL.",
    );
  });

  it("treats blank values as missing", () => {
    expect(() => readEnv({ ...base, SHEET_ID: "   " })).toThrow(/SHEET_ID/);
  });
});

describe("isAllowedEmail", () => {
  it("allows only the configured, verified address (case-insensitive)", () => {
    expect(isAllowedEmail("Me@Example.com", "me@example.com")).toBe(true);
    expect(isAllowedEmail("other@example.com", "me@example.com")).toBe(false);
    expect(isAllowedEmail("me@example.com", "me@example.com", false)).toBe(false);
    expect(isAllowedEmail("me@example.com", "me@example.com", null)).toBe(false);
    expect(isAllowedEmail("me@example.com", "me@example.com", true)).toBe(true);
    expect(isAllowedEmail(undefined, "me@example.com")).toBe(false);
    expect(isAllowedEmail("me@example.com", undefined)).toBe(false);
    expect(isAllowedEmail("me@example.com", "")).toBe(false);
  });
});
```

Create `tests/sheets/recon.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeSheet } from "@/lib/sheets/recon";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

describe("describeSheet", () => {
  it("summarises a healthy sheet without writing anything", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule() });
    const report = await describeSheet(fake, "Schedule", TOTAL_HEADER);

    expect(report.problems).toEqual([]);
    expect(report.headerRow).toBe(3);
    expect(report.portions).toHaveLength(5);
    expect(report.monthFormat).toBe('text such as "Sep-26"');
    expect([report.firstMonth, report.lastMonth, report.monthRows]).toEqual([
      "2026-08",
      "2026-09",
      2,
    ]);
    expect(report.lastDataRow).toBe(5);
    expect(report.totalCellIsFormula).toBe(true);
    expect(report.totalCellSample).toBe("=D5+G5+J5+M5+P5");
    expect(report.rowBelowTableEmpty).toBe(true);
    expect(report.hasSettingsTab).toBe(false);
    expect([...fake.tabs.keys()]).toEqual(["Schedule"]);
    expect(fake.calls.filter((c) => ["addTab", "updateValues", "cloneRow", "appendRow"].includes(c))).toEqual([]);
  });

  it("reports date-cell months", async () => {
    const fake = new FakeGateway({ Schedule: baseSchedule("serial") });
    expect((await describeSheet(fake, "Schedule", TOTAL_HEADER)).monthFormat).toBe("date cells");
  });

  it("flags a missing tab, a wrong total header, and a non-empty row below", async () => {
    const missing = await describeSheet(new FakeGateway({ Other: [] }), "Schedule", TOTAL_HEADER);
    expect(missing.problems[0]).toMatch(/Tab "Schedule" not found/);

    const wrongTotal = await describeSheet(
      new FakeGateway({ Schedule: baseSchedule() }),
      "Schedule",
      "Per Month",
    );
    expect(wrongTotal.problems[0]).toMatch(/Header "Per Month" was not found/);

    const schedule = baseSchedule();
    schedule.push(["Note"]);
    const crowded = await describeSheet(new FakeGateway({ Schedule: schedule }), "Schedule", TOTAL_HEADER);
    expect(crowded.rowBelowTableEmpty).toBe(false);
    expect(crowded.problems[0]).toMatch(/Row 6/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/env.test.ts tests/sheets/recon.test.ts`
Expected: FAIL, cannot resolve the two modules.

- [ ] **Step 3: Implement the environment helpers**

Create `src/lib/server/env.ts`:

```ts
import { configError } from "@/lib/errors";

export type AppEnv = {
  serviceAccountJson: string;
  sheetId: string;
  scheduleTab: string;
  totalHeader: string;
  allowedEmail: string;
};

const REQUIRED = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "SHEET_ID",
  "TOTAL_HEADER",
  "ALLOWED_EMAIL",
] as const;

/** Reads and checks the environment. Lists every missing variable at once. */
export function readEnv(env: Record<string, string | undefined>): AppEnv {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw configError(`Missing environment variables: ${missing.join(", ")}.`);
  }
  return {
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON!.trim(),
    sheetId: env.SHEET_ID!.trim(),
    scheduleTab: env.SCHEDULE_TAB?.trim() || "Schedule",
    totalHeader: env.TOTAL_HEADER!.trim(),
    allowedEmail: env.ALLOWED_EMAIL!.trim().toLowerCase(),
  };
}

/** True only for the one allowed, Google-verified email address. */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedEmail: string | undefined,
  emailVerified: boolean | null | undefined = true,
): boolean {
  if (!email || !allowedEmail || emailVerified === false || emailVerified === null) return false;
  return email.trim().toLowerCase() === allowedEmail.trim().toLowerCase();
}
```

- [ ] **Step 4: Implement the recon report and CLI**

Create `src/lib/sheets/recon.ts`:

```ts
import { AppError } from "@/lib/errors";
import { ymKey } from "@/lib/domain/year-month";
import { colLetter } from "./a1";
import type { SheetsGateway } from "./gateway";
import { findHeaderRowIndex, parseSchedule } from "./schedule";
import { inferPortions, LOG_TAB, SETTINGS_TAB } from "./settings-store";

export type ReconReport = {
  tabs: string[];
  hasSettingsTab: boolean;
  hasLogTab: boolean;
  headerRow: number | null;
  headers: string[];
  portions: { id: string; tenantHeader: string; countHeader: string; amountHeader: string }[];
  monthFormat: string | null;
  firstMonth: string | null;
  lastMonth: string | null;
  monthRows: number;
  lastDataRow: number | null;
  totalHeader: string;
  totalCellIsFormula: boolean | null;
  totalCellSample: string | null;
  rowBelowTableEmpty: boolean | null;
  problems: string[];
};

/**
 * Read-only check of a real spreadsheet against what the app expects. Never
 * writes, never creates tabs. Run it on a copy before the first real save.
 */
export async function describeSheet(
  gateway: SheetsGateway,
  scheduleTab: string,
  totalHeader: string,
): Promise<ReconReport> {
  const report: ReconReport = {
    tabs: await gateway.listTabs(),
    hasSettingsTab: false,
    hasLogTab: false,
    headerRow: null,
    headers: [],
    portions: [],
    monthFormat: null,
    firstMonth: null,
    lastMonth: null,
    monthRows: 0,
    lastDataRow: null,
    totalHeader,
    totalCellIsFormula: null,
    totalCellSample: null,
    rowBelowTableEmpty: null,
    problems: [],
  };
  report.hasSettingsTab = report.tabs.includes(SETTINGS_TAB);
  report.hasLogTab = report.tabs.includes(LOG_TAB);
  if (!report.tabs.includes(scheduleTab)) {
    report.problems.push(`Tab "${scheduleTab}" not found. Tabs are: ${report.tabs.join(", ")}.`);
    return report;
  }

  try {
    const values = await gateway.getValues(scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE");
    const headerIndex = findHeaderRowIndex(values);
    if (headerIndex === -1) {
      report.problems.push('No header row containing "Month" in the first 25 rows.');
      return report;
    }
    report.headerRow = headerIndex + 1;
    report.headers = values[headerIndex].map((cell) => String(cell ?? ""));

    const portions = inferPortions(values[headerIndex]);
    report.portions = portions.map(({ id, tenantHeader, countHeader, amountHeader }) => ({
      id,
      tenantHeader,
      countHeader,
      amountHeader,
    }));

    const { layout, rows } = parseSchedule(values, portions, totalHeader);
    report.monthFormat =
      layout.codec.kind === "serial"
        ? "date cells"
        : `text such as "${String(values[layout.lastDataRow - 1][layout.monthCol])}"`;
    report.monthRows = rows.length;
    report.firstMonth = ymKey(rows[0].month);
    report.lastMonth = ymKey(rows[rows.length - 1].month);
    report.lastDataRow = layout.lastDataRow;

    const totalA1 = `${colLetter(layout.totalCol)}${layout.lastDataRow}`;
    const total = (await gateway.getValues(scheduleTab, totalA1, "FORMULA"))[0]?.[0];
    report.totalCellIsFormula = typeof total === "string" && total.startsWith("=");
    report.totalCellSample = total === undefined ? null : String(total);

    const nextRow = layout.lastDataRow + 1;
    const below = await gateway.getValues(scheduleTab, `A${nextRow}:ZZ${nextRow}`, "FORMULA");
    report.rowBelowTableEmpty = !below.some((row) =>
      row.some((cell) => cell !== undefined && cell !== ""),
    );
    if (!report.rowBelowTableEmpty) {
      report.problems.push(
        `Row ${nextRow}, right under the last month, is not empty. The app cannot add a new month there.`,
      );
    }
  } catch (error) {
    report.problems.push(error instanceof AppError ? error.message : String(error));
  }
  return report;
}
```

Create `scripts/recon.ts`:

```ts
/**
 * Read-only check of your real Google Sheet. Prints what RentBook sees and
 * lists anything it cannot handle. Never writes to the Sheet.
 *
 *   npx tsx --env-file=.env.local scripts/recon.ts
 */
import { AppError } from "@/lib/errors";
import { readEnv } from "@/lib/server/env";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { describeSheet } from "@/lib/sheets/recon";

async function main() {
  const env = readEnv(process.env);
  const gateway = GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId);
  const report = await describeSheet(gateway, env.scheduleTab, env.totalHeader);
  console.log(JSON.stringify(report, null, 2));
  if (report.problems.length > 0) {
    console.error(`\n${report.problems.length} problem(s) found. See "problems" above.`);
    process.exitCode = 1;
  } else {
    console.log("\nNo problems found. RentBook can work with this Sheet.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof AppError ? error.message : error);
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/server/env.test.ts tests/sheets/recon.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run recon against the TEST COPY of the real Sheet**

```bash
npm run recon
```

Expected on success: JSON with `"problems": []` and the last line "No problems found". Check each field against reality:

| Field | What to confirm |
| --- | --- |
| `headerRow`, `headers` | Matches the header row you see in the Sheet |
| `portions` | Five portions with the right Tenant/Count/Amount headers |
| `monthFormat` | `date cells`, or text like `"Sep-26"` that matches how the Month column looks |
| `lastMonth`, `monthRows` | The latest month and row count you expect |
| `totalCellIsFormula` | Whether the total column holds a formula, and `totalCellSample` looks right |
| `rowBelowTableEmpty` | `true` |

If recon prints problems, **stop here**. Typical causes and what to do:

- "This file is an Excel (.xlsx) file": convert the Sheet (SETUP.md step 1) and update `SHEET_ID`.
- "Google denied access": share the Sheet with the service account (SETUP.md step 4).
- "Header ... was not found": fix `SCHEDULE_TAB` or `TOTAL_HEADER`, or tell the owner the header text differs from the plan's assumption.
- "Row N ... is not empty": the Sheet has content or a pre-filled template row right under the last month. Discuss with the owner before changing the app; do not delete their content.

Record the confirmed `monthFormat` and `totalCellIsFormula` values in the spec's "Open items" section.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/env.ts src/lib/sheets/recon.ts scripts/recon.ts tests/server/env.test.ts tests/sheets/recon.test.ts docs
git commit -m "feat: add environment checks and read-only Sheet recon" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Auth, HTTP wrapper, and API routes

**Files:**
- Create: `src/lib/server/schemas.ts`, `src/lib/server/http.ts`, `src/lib/server/context.ts`, `src/lib/server/auth-guard.ts`, `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/payments/route.ts`, `src/app/api/payments/log-retry/route.ts`, `src/app/api/settings/route.ts`
- Test: `tests/server/http.test.ts`

**Interfaces:**
- Consumes: `AppError`, `logPayment`, `retryLogRow`, `saveSettings`, `GoogleSheetsGateway`, `readEnv`, `isAllowedEmail`.
- Produces: `paymentBody`, `logRetryBody`, `settingsBody` (zod schemas); `handle(run): Promise<Response>` (success `{ok: true, ...}`, failure `{ok: false, error: {code, message, details?}}` with status 401/400/409/422/500); `parseJson(request, schema)`; `getSheetsContext(): SheetsContext` (cached); `requireUser(): Promise<string>` (throws `unauthorized`); `isSignedIn(): Promise<boolean>`; Auth.js exports `handlers`, `auth`, `signIn`, `signOut`.
- API: `POST /api/payments` body `{month: "YYYY-MM", portionId, amount, dateReceived, newTenantName?, overwrite?}`; `POST /api/payments/log-retry` body `{row: LogRow}`; `PUT /api/settings` body `{portions: [{id, name, cycleLength|null, hikePercent}]}`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/http.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { conflict, configError, sheetStructure, unauthorized, validation } from "@/lib/errors";
import { handle, parseJson } from "@/lib/server/http";
import { logRetryBody, paymentBody, settingsBody } from "@/lib/server/schemas";

afterEach(() => vi.restoreAllMocks());

describe("handle", () => {
  it("wraps a result with ok: true", async () => {
    const res = await handle(async () => ({ value: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, value: 1 });
  });

  it.each([
    [unauthorized(), 401, "unauthorized"],
    [validation("bad"), 400, "validation"],
    [conflict("dup", { existingAmount: 5 }), 409, "conflict"],
    [sheetStructure("moved"), 422, "sheet-structure"],
    [configError("setup"), 500, "config"],
  ])("maps %s to status %i", async (error, status, code) => {
    const res = await handle(async () => {
      throw error;
    });
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBe(error.message);
  });

  it("includes conflict details", async () => {
    const res = await handle(async () => {
      throw conflict("dup", { existingAmount: 5 });
    });
    expect((await res.json()).error.details).toEqual({ existingAmount: 5 });
  });

  it("hides unknown error text and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handle(async () => {
      throw new Error("secret stack detail");
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(log).toHaveBeenCalled();
  });
});

describe("parseJson", () => {
  const req = (body: string) => new Request("http://x", { method: "POST", body });

  it("returns typed data for a valid body", async () => {
    const data = await parseJson(
      req(JSON.stringify({ month: "2026-10", portionId: "p1", amount: 5450, dateReceived: "2026-10-05" })),
      paymentBody,
    );
    expect(data.amount).toBe(5450);
  });

  it("reports the first problem with its field name", async () => {
    await expect(
      parseJson(req(JSON.stringify({ month: "Oct", portionId: "p1", amount: 1, dateReceived: "x" })), paymentBody),
    ).rejects.toThrow(/month: month must look like/);
  });

  it("rejects non-JSON", async () => {
    await expect(parseJson(req("{oops"), paymentBody)).rejects.toThrow(/must be JSON/);
  });

  it("validates the log retry row shape and settings payload", async () => {
    const row = ["t", "2026-10", "P", "A", 1, 1, "2026-10-05"];
    expect((await parseJson(req(JSON.stringify({ row })), logRetryBody)).row).toHaveLength(7);
    await expect(parseJson(req(JSON.stringify({ row: ["x"] })), logRetryBody)).rejects.toThrow();
    await expect(parseJson(req(JSON.stringify({ portions: [] })), settingsBody)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/server/http.test.ts`
Expected: FAIL, cannot resolve `@/lib/server/http`.

- [ ] **Step 3: Write the request schemas**

Create `src/lib/server/schemas.ts`:

```ts
import { z } from "zod";

export const paymentBody = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-10"),
  portionId: z.string().min(1).max(20),
  amount: z.number(),
  dateReceived: z.string(),
  newTenantName: z.string().optional(),
  overwrite: z.boolean().optional(),
});

export const logRetryBody = z.object({
  row: z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.number(),
    z.number(),
    z.string(),
  ]),
});

export const settingsBody = z.object({
  portions: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        name: z.string(),
        cycleLength: z.number().nullable(),
        hikePercent: z.number(),
      }),
    )
    .min(1)
    .max(20),
});
```

- [ ] **Step 4: Write the HTTP wrapper**

Create `src/lib/server/http.ts`:

```ts
import type { z } from "zod";
import { AppError, validation } from "@/lib/errors";

const STATUS: Record<AppError["code"], number> = {
  unauthorized: 401,
  validation: 400,
  conflict: 409,
  "sheet-structure": 422,
  config: 500,
};

/**
 * Runs a route handler body and turns its result or error into JSON.
 * Success: { ok: true, ...result }. Failure: { ok: false, error: { code, message, details? } }.
 * Unknown errors are logged and shown as a generic message.
 */
export async function handle(run: () => Promise<Record<string, unknown>>): Promise<Response> {
  try {
    const result = await run();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(
        { ok: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: STATUS[error.code] },
      );
    }
    console.error(error);
    return Response.json(
      { ok: false, error: { code: "internal", message: "Something went wrong. Try again." } },
      { status: 500 },
    );
  }
}

export async function parseJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validation("Request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw validation(`${where}${issue.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/server/http.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the Sheets context, Auth.js config, and guard**

Create `src/lib/server/context.ts`:

```ts
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import type { SheetsContext } from "@/lib/sheets/service";
import { readEnv } from "./env";

let cached: SheetsContext | undefined;

/** The shared Sheets context for this server instance. */
export function getSheetsContext(): SheetsContext {
  if (!cached) {
    const env = readEnv(process.env);
    cached = {
      gateway: GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId),
      scheduleTab: env.scheduleTab,
      totalHeader: env.totalHeader,
    };
  }
  return cached;
}
```

Create `src/auth.ts`:

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "@/lib/server/env";

/**
 * Google sign-in, restricted to ALLOWED_EMAIL. Reads AUTH_SECRET,
 * AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ profile }) {
      return isAllowedEmail(profile?.email, process.env.ALLOWED_EMAIL, profile?.email_verified);
    },
  },
});
```

Create `src/lib/server/auth-guard.ts`:

```ts
import { auth } from "@/auth";
import { unauthorized } from "@/lib/errors";
import { isAllowedEmail } from "./env";

/** Returns the signed-in owner's email, or throws an `unauthorized` AppError. */
export async function requireUser(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL)) throw unauthorized();
  return email!;
}

/** Same check for pages: true when the visitor is the signed-in owner. */
export async function isSignedIn(): Promise<boolean> {
  const session = await auth();
  return isAllowedEmail(session?.user?.email, process.env.ALLOWED_EMAIL);
}
```

- [ ] **Step 7: Write the route handlers**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

Create `src/app/api/payments/route.ts`:

```ts
import { parseYmKey } from "@/lib/domain/year-month";
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { paymentBody } from "@/lib/server/schemas";
import { logPayment } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    await requireUser();
    const body = await parseJson(request, paymentBody);
    const result = await logPayment(
      getSheetsContext(),
      {
        month: parseYmKey(body.month)!,
        portionId: body.portionId,
        amount: body.amount,
        dateReceived: body.dateReceived,
        newTenantName: body.newTenantName,
        overwrite: body.overwrite,
      },
      { now: new Date() },
    );
    return { ...result };
  });
}
```

Create `src/app/api/payments/log-retry/route.ts`:

```ts
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { logRetryBody } from "@/lib/server/schemas";
import { retryLogRow } from "@/lib/sheets/service";

export async function POST(request: Request) {
  return handle(async () => {
    await requireUser();
    const { row } = await parseJson(request, logRetryBody);
    return { logWritten: await retryLogRow(getSheetsContext(), row) };
  });
}
```

Create `src/app/api/settings/route.ts`:

```ts
import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { settingsBody } from "@/lib/server/schemas";
import { saveSettings } from "@/lib/sheets/service";

export async function PUT(request: Request) {
  return handle(async () => {
    await requireUser();
    const { portions } = await parseJson(request, settingsBody);
    return { portions: await saveSettings(getSheetsContext(), portions) };
  });
}
```

- [ ] **Step 8: Verify the whole project**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: all pass.

- [ ] **Step 9: Smoke-test that unauthenticated requests are refused**

Build and start the production server with placeholder auth values (this needs no real Google credentials), then request a few routes. In one PowerShell terminal:

```powershell
$env:AUTH_SECRET='smoke-test-secret-value-1234567890'; $env:ALLOWED_EMAIL='me@example.com'; $env:AUTH_GOOGLE_ID='id'; $env:AUTH_GOOGLE_SECRET='secret'; $env:AUTH_TRUST_HOST='true'
npx next build
npx next start -p 3123
```

And in another:

```powershell
Invoke-WebRequest http://localhost:3123/api/payments -Method Post -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck | Select-Object StatusCode, Content
Invoke-WebRequest http://localhost:3123/api/settings -Method Put -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck | Select-Object StatusCode, Content
```

Expected: both return `401` with `{"ok":false,"error":{"code":"unauthorized",...}}`. Stop the server with Ctrl+C.

- [ ] **Step 10: Commit**

```bash
git add src tests
git commit -m "feat: add Google sign-in, HTTP wrapper, and API routes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Theme, formatting, sign-in page, and installable app shell

**Files:**
- Modify (replace entire file): `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/lib/format.ts`, `src/app/signin/page.tsx`, `src/app/manifest.ts`, `src/app/icon.tsx`, `src/app/apple-icon.tsx`
- Test: `tests/domain/format.test.ts`

**Interfaces:**
- Produces: `formatRupees(amount): string` (`5450` -> `₹ 5,450`, Indian grouping), `formatMonthTitle(ym): string` (`October 2026`); Tailwind color tokens `background`, `foreground`, `surface`, `muted`, `line`, `accent`, `accent-ink`, `success-bg/ink`, `warn-bg/ink`, `danger-bg/ink` (light and dark).

- [ ] **Step 1: Write the failing test**

Create `tests/domain/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMonthTitle, formatRupees } from "@/lib/format";

describe("format", () => {
  it("formats rupees with Indian digit grouping", () => {
    expect(formatRupees(5450)).toBe("₹ 5,450");
    expect(formatRupees(1234567)).toBe("₹ 12,34,567");
    expect(formatRupees(0)).toBe("₹ 0");
  });
  it("formats a month title", () => {
    expect(formatMonthTitle({ year: 2026, month: 10 })).toBe("October 2026");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/domain/format.test.ts`
Expected: FAIL, cannot resolve `@/lib/format`.

- [ ] **Step 3: Implement formatting**

Create `src/lib/format.ts`:

```ts
import type { YearMonth } from "@/lib/domain/types";
import { monthName } from "@/lib/domain/year-month";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 5450 -> "₹ 5,450", 1234567 -> "₹ 12,34,567". */
export function formatRupees(amount: number): string {
  return `₹ ${rupees.format(amount)}`;
}

/** { year: 2026, month: 10 } -> "October 2026". */
export function formatMonthTitle(ym: YearMonth): string {
  return `${monthName(ym.month, true)} ${ym.year}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/domain/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace the scaffold theme and layout**

Replace the whole of `src/app/globals.css`:

```css
@import "tailwindcss";

:root {
  --background: #f6f5f1;
  --foreground: #1b1b18;
  --surface: #ffffff;
  --muted: #6b6a63;
  --line: #e4e2da;
  --accent: #1f5f4a;
  --accent-ink: #ffffff;
  --success-bg: #e3f1e8;
  --success-ink: #1d5a37;
  --warn-bg: #fbefd5;
  --warn-ink: #7a4f0a;
  --danger-bg: #fbe4e1;
  --danger-ink: #8f2a1f;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #121311;
    --foreground: #ecebe5;
    --surface: #1b1c19;
    --muted: #a3a299;
    --line: #2e2f2a;
    --accent: #6fc2a0;
    --accent-ink: #0d1f18;
    --success-bg: #1e3a2a;
    --success-ink: #9fdcb8;
    --warn-bg: #40320f;
    --warn-ink: #f0cf8a;
    --danger-bg: #4a1f1a;
    --danger-ink: #f4b3aa;
  }
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-success-bg: var(--success-bg);
  --color-success-ink: var(--success-ink);
  --color-warn-bg: var(--warn-bg);
  --color-warn-ink: var(--warn-ink);
  --color-danger-bg: var(--danger-bg);
  --color-danger-ink: var(--danger-ink);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-geist-sans), system-ui, sans-serif;
}
```

Replace the whole of `src/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RentBook",
  description: "Record monthly rent receipts into your Google Sheet.",
  appleWebApp: { capable: true, title: "RentBook", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f5f4a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Add the sign-in page and the installable-app files**

Create `src/app/signin/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isSignedIn } from "@/lib/server/auth-guard";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isSignedIn()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">RentBook</h1>
      <p className="mt-1 text-muted">Sign in to record rent receipts.</p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink"
        >
          {error === "AccessDenied"
            ? "That Google account isn't allowed to use RentBook."
            : "Sign-in failed. Try again."}
        </p>
      )}

      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
```

Create `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RentBook",
    short_name: "RentBook",
    description: "Record monthly rent receipts into your Google Sheet.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#1f5f4a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
```

Create `src/app/icon.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1f5f4a",
          color: "#ffffff",
          fontSize: 300,
          fontWeight: 700,
        }}
      >
        ₹
      </div>
    ),
    size,
  );
}
```

Create `src/app/apple-icon.tsx`:

```tsx
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1f5f4a",
          color: "#ffffff",
          fontSize: 110,
          fontWeight: 700,
        }}
      >
        ₹
      </div>
    ),
    size,
  );
}
```

- [ ] **Step 7: Verify**

```bash
npm test && npm run typecheck && npm run lint && npx next build
```

Expected: all pass. The build's route table lists `/signin`, `/icon`, `/apple-icon`, and `/manifest.webmanifest`.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat: add theme, sign-in page, and installable app shell" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Month overview and payment sheet

**Files:**
- Replace (entire file): `src/app/page.tsx`
- Create: `src/components/PortionBoard.tsx`, `src/components/PaymentSheet.tsx`

**Interfaces:**
- Consumes: `getMonthView`, `getSheetsContext`, `isSignedIn`, `formatRupees`, `formatMonthTitle`, `addMonths`, `currentYm`, `parseYmKey`, `todayIso`, `ymKey`, `PortionCard`, `MonthView`; API `POST /api/payments` and `POST /api/payments/log-retry`.
- Produces: the month screen at `/` (`?month=YYYY-MM`), matching the approved mockups:
  - Header with previous/next month links.
  - Summary: received of expected, portions paid, progress bar.
  - One card per portion: name, status pill (Paid / Pending / No tenant), tenant and "Payment N of cycle", amount, new-cycle hint, last-of-cycle hint, and one button (Log payment / Edit amount / Add tenant).
  - A "New tenant" button below the cards, and footer links to Portion settings and Sign out.
  - A bottom sheet for log / edit / new tenant. It prefills the hike on a new cycle with a "Keep old rent" button, asks to confirm before replacing an existing amount, and shows a "Retry log entry" screen when only the Payments Log write failed.

- [ ] **Step 1: Replace the home page**

Replace the whole of `src/app/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import PortionBoard from "@/components/PortionBoard";
import type { MonthView } from "@/lib/domain/types";
import { addMonths, currentYm, parseYmKey, todayIso, ymKey } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { formatMonthTitle, formatRupees } from "@/lib/format";
import { isSignedIn } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { getMonthView } from "@/lib/sheets/service";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  if (!(await isSignedIn())) redirect("/signin");

  const { month: param } = await searchParams;
  const now = new Date();
  const month = (param ? parseYmKey(param) : null) ?? currentYm(now);

  let view: MonthView | null = null;
  let problem: string | null = null;
  try {
    view = await getMonthView(getSheetsContext(), month);
  } catch (error) {
    if (error instanceof AppError) {
      problem = error.message;
    } else {
      console.error(error);
      problem = "Couldn't reach Google Sheets. Try again.";
    }
  }

  const prev = ymKey(addMonths(month, -1));
  const next = ymKey(addMonths(month, 1));
  const title = formatMonthTitle(month);
  const progress =
    view && view.expected > 0 ? Math.min(100, Math.round((view.received / view.expected) * 100)) : 0;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">
      <nav className="flex items-center justify-between">
        <Link href={`/?month=${prev}`} aria-label="Previous month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ‹
        </Link>
        <h1 className="text-lg font-semibold">{title}</h1>
        <Link href={`/?month=${next}`} aria-label="Next month" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl">
          ›
        </Link>
      </nav>

      {problem && (
        <div role="alert" className="mt-4 rounded-2xl bg-danger-bg p-4 text-danger-ink">
          <p className="font-medium">Can&apos;t load your Sheet</p>
          <p className="mt-1 text-sm">{problem}</p>
          <Link href={`/?month=${ymKey(month)}`} className="mt-3 inline-block min-h-11 rounded-xl border border-current px-4 py-2.5 text-sm font-medium">
            Try again
          </Link>
        </div>
      )}

      {view && (
        <>
          <section className="mt-3 rounded-2xl bg-surface p-4 ring-1 ring-line" aria-label="Month summary">
            <div className="flex items-baseline justify-between text-sm text-muted">
              <span>Received</span>
              <span>
                {view.paidCount} of {view.cards.length} portions
              </span>
            </div>
            <p className="mt-0.5 text-2xl font-semibold">
              {formatRupees(view.received)}{" "}
              <span className="text-sm font-normal text-muted">of {formatRupees(view.expected)}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
              <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
          </section>

          <PortionBoard
            monthKey={ymKey(month)}
            monthLabel={title}
            cards={view.cards}
            defaultDate={todayIso(now)}
          />
        </>
      )}

      <footer className="mt-6 flex items-center justify-between text-sm">
        <Link href="/settings" className="grid min-h-11 place-items-center text-muted underline">
          Portion settings
        </Link>
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
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Add the board and the sheet**

Create `src/components/PortionBoard.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";
import PaymentSheet, { type SheetMode } from "./PaymentSheet";

type Props = {
  monthKey: string;
  monthLabel: string;
  cards: PortionCard[];
  defaultDate: string;
};

type Active = { mode: SheetMode; portionId: string | null } | null;

const PILL = {
  paid: "bg-success-bg text-success-ink",
  pending: "bg-warn-bg text-warn-ink",
  "needs-tenant": "bg-line text-muted",
} as const;

const PILL_LABEL = {
  paid: "Paid",
  pending: "Pending",
  "needs-tenant": "No tenant",
} as const;

export default function PortionBoard({ monthKey, monthLabel, cards, defaultDate }: Props) {
  const [active, setActive] = useState<Active>(null);

  return (
    <>
      <ul className="mt-3 space-y-3">
        {cards.map((card) => {
          const count = card.entry?.count ?? card.next?.count;
          const tenant = card.entry?.tenant ?? card.next?.tenant;
          const lastOfCycle =
            card.cycleLength !== null && count !== undefined && count === card.cycleLength;
          return (
            <li key={card.portionId}>
              <article className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium">{card.name}</h2>
                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium ${PILL[card.status]}`}
                  >
                    {PILL_LABEL[card.status]}
                  </span>
                </div>

                {card.status === "needs-tenant" ? (
                  <p className="mt-1 text-sm text-muted">No tenant recorded yet.</p>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    {tenant} · Payment {count}
                    {card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}
                  </p>
                )}

                {card.status !== "needs-tenant" && (
                  <p className="mt-2 text-lg font-medium">
                    {formatRupees(card.entry?.amount ?? card.next!.suggestedAmount)}
                  </p>
                )}

                {card.status === "pending" && card.next?.startsNewCycle && (
                  <p className="mt-1 text-sm text-muted">
                    New cycle. Suggested rent includes the hike (was{" "}
                    {formatRupees(card.next.previousAmount)}).
                  </p>
                )}
                {lastOfCycle && (
                  <p className="mt-1 text-sm text-muted">Last payment of this cycle.</p>
                )}

                <div className="mt-3 flex gap-2">
                  {card.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => setActive({ mode: "log", portionId: card.portionId })}
                      className="min-h-11 flex-1 rounded-xl bg-accent px-4 font-medium text-accent-ink"
                    >
                      Log payment
                    </button>
                  )}
                  {card.status === "paid" && (
                    <button
                      type="button"
                      onClick={() => setActive({ mode: "edit", portionId: card.portionId })}
                      className="min-h-11 flex-1 rounded-xl border border-line px-4 font-medium"
                    >
                      Edit amount
                    </button>
                  )}
                  {card.status === "needs-tenant" && (
                    <button
                      type="button"
                      onClick={() => setActive({ mode: "new-tenant", portionId: card.portionId })}
                      className="min-h-11 flex-1 rounded-xl bg-accent px-4 font-medium text-accent-ink"
                    >
                      Add tenant
                    </button>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setActive({ mode: "new-tenant", portionId: null })}
          className="min-h-11 w-full rounded-xl border border-line px-4 font-medium"
        >
          New tenant
        </button>
      </div>

      {active && (
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
      )}
    </>
  );
}
```

Create `src/components/PaymentSheet.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PortionCard } from "@/lib/domain/types";
import { formatRupees } from "@/lib/format";

export type SheetMode = "log" | "edit" | "new-tenant";

type Props = {
  mode: SheetMode;
  monthKey: string;
  monthLabel: string;
  cards: PortionCard[];
  initialPortionId: string | null;
  defaultDate: string;
  onClose: () => void;
};

type ApiError = { code: string; message: string; details?: Record<string, unknown> };
type ApiBody = { ok: boolean; error?: ApiError; logWritten?: boolean; logRow?: unknown[] };

async function postJson(url: string, method: string, payload: unknown): Promise<ApiBody | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as ApiBody;
  } catch {
    return null;
  }
}

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

export default function PaymentSheet({
  mode,
  monthKey,
  monthLabel,
  cards,
  initialPortionId,
  defaultDate,
  onClose,
}: Props) {
  const router = useRouter();
  const [portionId, setPortionId] = useState(initialPortionId ?? cards[0].portionId);
  const card = cards.find((c) => c.portionId === portionId)!;

  const initialAmount =
    mode === "edit"
      ? card.entry?.amount
      : mode === "log"
        ? card.next?.suggestedAmount
        : undefined;
  const [amount, setAmount] = useState(initialAmount !== undefined ? String(initialAmount) : "");
  const [date, setDate] = useState(defaultDate);
  const [tenantName, setTenantName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ amount: number; tenant: string } | null>(null);
  const [pendingLog, setPendingLog] = useState<unknown[] | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const title =
    mode === "new-tenant" ? "New tenant" : mode === "edit" ? "Edit amount" : "Log payment";

  async function submit(overwrite: boolean) {
    setBusy(true);
    setError(null);
    const body = await postJson("/api/payments", "POST", {
      month: monthKey,
      portionId,
      amount: Number(amount.replace(/[,\s₹]/g, "")),
      dateReceived: date,
      newTenantName: mode === "new-tenant" ? tenantName : undefined,
      overwrite: overwrite || mode === "edit" ? true : undefined,
    });
    setBusy(false);

    if (!body) return setError(OFFLINE);
    if (body.ok) {
      router.refresh();
      if (body.logWritten === false) return setPendingLog(body.logRow ?? []);
      return onClose();
    }
    const failure = body.error!;
    if (failure.code === "conflict" && typeof failure.details?.existingAmount === "number") {
      return setConflict({
        amount: failure.details.existingAmount,
        tenant: String(failure.details.existingTenant ?? ""),
      });
    }
    setError(failure.message);
  }

  async function retryLog() {
    setBusy(true);
    const body = await postJson("/api/payments/log-retry", "POST", { row: pendingLog });
    setBusy(false);
    if (body?.ok && body.logWritten) return onClose();
    setError("The log entry still didn't save. The payment itself is safe in your Schedule.");
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="max-h-dvh w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="sheet-title" className="text-lg font-semibold">
              {title}
            </h2>
            <p className="text-sm text-muted">
              {monthLabel}
              {mode !== "new-tenant" ? ` · ${card.name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="min-h-11 min-w-11 rounded-lg text-xl text-muted"
          >
            ×
          </button>
        </div>

        {pendingLog ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              Saved to your Schedule, but the Payments Log entry didn&apos;t save.
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
            <button type="button" onClick={onClose} className="min-h-11 w-full text-muted">
              Skip for now
            </button>
          </div>
        ) : conflict ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
              {card.name} already has {formatRupees(conflict.amount)} recorded for {monthLabel}
              {conflict.tenant ? ` (${conflict.tenant})` : ""}. Replace it with{" "}
              {formatRupees(Number(amount.replace(/[,\s₹]/g, "")))}?
            </p>
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
            >
              {busy ? "Saving…" : "Replace amount"}
            </button>
            <button
              type="button"
              onClick={() => setConflict(null)}
              disabled={busy}
              className="min-h-11 w-full text-muted"
            >
              Go back
            </button>
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
          >
            {mode === "new-tenant" && (
              <>
                <label className="block text-sm">
                  <span className="text-muted">Portion</span>
                  <select
                    value={portionId}
                    onChange={(event) => setPortionId(event.target.value)}
                    className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
                  >
                    {cards.map((c) => (
                      <option key={c.portionId} value={c.portionId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Tenant name</span>
                  <input
                    value={tenantName}
                    onChange={(event) => setTenantName(event.target.value)}
                    autoComplete="off"
                    autoFocus
                    required
                    maxLength={60}
                    className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
                  />
                </label>
              </>
            )}

            {mode === "log" && card.next?.startsNewCycle && (
              <p className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success-ink">
                New cycle starts at payment 1. Amount is prefilled with the hike
                (was {formatRupees(card.next.previousAmount)}). Edit it if you agreed a different
                rent.
                <button
                  type="button"
                  onClick={() => setAmount(String(card.next!.previousAmount))}
                  className="ml-2 underline"
                >
                  Keep {formatRupees(card.next.previousAmount)}
                </button>
              </p>
            )}

            <label className="block text-sm">
              <span className="text-muted">Amount received (₹)</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                autoFocus={mode !== "new-tenant"}
                required
                className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-lg"
              />
            </label>

            <label className="block text-sm">
              <span className="text-muted">Date received</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
              />
            </label>

            {mode === "log" && card.next && (
              <p className="text-sm text-muted">
                {card.next.tenant} · Payment {card.next.count}
                {card.cycleLength !== null ? ` of ${card.cycleLength}` : ""}. The count is set
                automatically.
              </p>
            )}
            {mode === "new-tenant" && (
              <p className="text-sm text-muted">Count restarts at 1 for a new tenant.</p>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-ink">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
            >
              {busy ? "Saving…" : "Save to sheet"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npm test && npm run typecheck && npm run lint && npx next build
```

Expected: all pass. The route table shows `/` as dynamic.

- [ ] **Step 4: Look at it for real**

With `.env.local` pointing at the TEST COPY, run `npm run dev`, open http://localhost:3000, sign in, and confirm:

- The current month's cards appear with the right tenant, count, and rent.
- A pending card's "Log payment" opens the sheet with the amount prefilled.
- Close the sheet without saving. Nothing changes in the Sheet.

Saving is exercised in Task 18. If the page shows an error panel instead, read its message: it names the exact problem (access, header, tab).

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add month overview and payment sheet" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Portion settings page

**Files:**
- Create: `src/app/settings/page.tsx`, `src/components/SettingsForm.tsx`

**Interfaces:**
- Consumes: `getSettings`, `getSheetsContext`, `isSignedIn`; API `PUT /api/settings`.
- Produces: `/settings`: one block per portion with Name, Cycle length, Hike %, and a "Count never resets" checkbox (sends `cycleLength: null`). Saved values land in the Settings tab.

- [ ] **Step 1: Add the page and the form**

Create `src/app/settings/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import SettingsForm from "@/components/SettingsForm";
import type { PortionConfig } from "@/lib/domain/types";
import { AppError } from "@/lib/errors";
import { isSignedIn } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { getSettings } from "@/lib/sheets/service";

export default async function SettingsPage() {
  if (!(await isSignedIn())) redirect("/signin");

  let portions: PortionConfig[] | null = null;
  let problem: string | null = null;
  try {
    portions = await getSettings(getSheetsContext());
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
        <h1 className="text-lg font-semibold">Portion settings</h1>
      </nav>

      {problem && (
        <p role="alert" className="mt-4 rounded-2xl bg-danger-bg p-4 text-sm text-danger-ink">
          {problem}
        </p>
      )}
      {portions && <SettingsForm portions={portions} />}
    </main>
  );
}
```

Create `src/components/SettingsForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PortionConfig } from "@/lib/domain/types";

type Row = { id: string; name: string; cycle: string; never: boolean; hike: string };

const toRow = (p: PortionConfig): Row => ({
  id: p.id,
  name: p.name,
  cycle: p.cycleLength === null ? "11" : String(p.cycleLength),
  never: p.cycleLength === null,
  hike: String(p.hikePercent),
});

export default function SettingsForm({ portions }: { portions: PortionConfig[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(() => portions.map(toRow));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portions: rows.map((row) => ({
            id: row.id,
            name: row.name,
            cycleLength: row.never ? null : Number(row.cycle),
            hikePercent: Number(row.hike),
          })),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (body.ok) {
        setMessage({ kind: "ok", text: "Saved" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: body.error?.message ?? "Couldn't save settings." });
      }
    } catch {
      setMessage({ kind: "error", text: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {rows.map((row) => (
        <fieldset key={row.id} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <label className="block text-sm">
            <span className="text-muted">Name</span>
            <input
              value={row.name}
              onChange={(event) => update(row.id, { name: event.target.value })}
              required
              maxLength={60}
              className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted">Cycle length</span>
              <input
                value={row.cycle}
                onChange={(event) => update(row.id, { cycle: event.target.value })}
                inputMode="numeric"
                disabled={row.never}
                className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3 disabled:opacity-50"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Hike %</span>
              <input
                value={row.hike}
                onChange={(event) => update(row.id, { hike: event.target.value })}
                inputMode="decimal"
                className="mt-1 min-h-12 w-full rounded-xl border border-line bg-surface px-3"
              />
            </label>
          </div>

          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={row.never}
              onChange={(event) => update(row.id, { never: event.target.checked })}
              className="size-5"
            />
            Count never resets
          </label>
        </fieldset>
      ))}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${
            message.kind === "ok" ? "bg-success-bg text-success-ink" : "bg-danger-bg text-danger-ink"
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-12 w-full rounded-xl bg-accent px-4 font-medium text-accent-ink"
      >
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npm test && npm run typecheck && npm run lint && npx next build
```

Expected: all pass; the route table lists `/settings`.

- [ ] **Step 3: Try it on the TEST COPY**

Run `npm run dev`, open `/settings`, change one portion's cycle length, save, then check the Settings tab in the Sheet copy. The change should appear in that portion's row. Set it back.

- [ ] **Step 4: Remove unused scaffold images**

Search the project for `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`. If nothing references them, delete them from `public/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add portion settings page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: README and Vercel deployment

**Files:**
- Replace (entire file): `README.md`

- [ ] **Step 1: Replace the README**

````markdown
# RentBook

A phone-first web app for recording monthly rent receipts for a building with five portions. It writes into your existing Google Sheet, which stays the only place the data lives.

- Month overview with one card per portion: tenant, payment count, rent, Paid or Pending.
- Log a payment in a few taps. The count and the 5% hike suggestion are worked out for you, and you can edit the amount.
- Per-portion cycle length (or "never resets") and hike percent.
- Each payment also lands in a `Payments Log` tab with the date it was received.

## Develop

```bash
npm install
cp .env.example .env.local   # then fill it in, see SETUP.md
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run recon` | Read-only check of your Google Sheet. Never writes |

## Setup and deployment

See [SETUP.md](SETUP.md).

## How it works

Rules live in `src/lib/domain` (pure, no I/O). Everything that touches the Sheet is in `src/lib/sheets`, behind one interface, so tests use an in-memory fake. Design notes are in `docs/superpowers/specs/`.
````

- [ ] **Step 2: Final local verification**

```bash
npm test && npm run typecheck && npm run lint && npx next build
```

Expected: all pass (121 tests).

- [ ] **Step 3: Push the branch and open a pull request**

**Ask the owner before pushing.**

```bash
git add README.md
git commit -m "docs: add README" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feat/rentbook-v1
```

Open a pull request from `feat/rentbook-v1` to `main` titled "RentBook v1". End the description with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: Owner: deploy on Vercel using SETUP.md step 7**

Use the TEST COPY's `SHEET_ID` for the first deploy. Vercel builds a preview for the branch; check the preview URL loads `/signin`. Add the preview or production URL's callback to the OAuth client's redirect URIs, then sign in on your phone.

---

### Task 18: End-to-end pass on the test copy, then go live

**Files:** none (verification and configuration only)

Do this on the phone, against the deployed app pointing at the TEST COPY. Tick each box only after checking the Sheet itself, not just the app.

- [ ] **Step 1: Access control**
  - Signing in with a different Google account is refused with "That Google account isn't allowed".
  - Opening `/settings` or calling the API while signed out redirects to sign-in or returns 401.

- [ ] **Step 2: First payment of a new month**
  - Pick a portion mid-cycle and tap Log payment. Amount is prefilled with the same rent; the sheet text says the count is automatic.
  - After saving, the Sheet has a new row under the last month. Check: the Month cell matches the existing format, only that portion's three cells are filled, the other portions' cells are blank, the total column matches how earlier rows behave (formula copied, or a number equal to the amount), and formatting (borders, shading, rupee format) matches the row above.
  - The Payments Log tab has a new row with the date received you entered.

- [ ] **Step 3: More payments in the same month**
  - Log a second portion with an edited amount. The same row is reused (no second month row) and the total updates.

- [ ] **Step 4: The cycle wrap and hike**
  - For a portion at the end of its cycle (count equals cycle length), the card says "Last payment of this cycle". Next month, the sheet shows count 1 and the amount prefilled with +5%.
  - Edit the amount to something else and save; the edited value is what lands in the Sheet. Try "Keep old rent" once too.
  - (To set this up without waiting a month, change that portion's cycle length in Portion settings to match its current count, test, then restore the setting.)

- [ ] **Step 5: Duplicates and edits**
  - Tap Edit amount on a Paid card, change the amount, save. The same row updates; the count does not change; a second Payments Log row is added.
  - Use New tenant on a portion that is already Paid this month and confirm the "Replace amount" warning appears.

- [ ] **Step 6: New tenant and "never resets"**
  - New tenant on any portion: count becomes 1, the typed rent is saved.
  - In Portion settings tick "Count never resets" on a portion, log it, and confirm the count keeps going past its old cycle length. Restore the setting.

- [ ] **Step 7: Failure behavior**
  - Turn on airplane mode, try to save: the sheet shows "Couldn't reach the server..." and nothing is written.
  - Remove the service account's access to the copy, reload: the page shows the access message naming the service account email. Restore access.

- [ ] **Step 8: Install on the phone**
  - Use Add to Home Screen. The app opens full-screen with the ₹ icon.

- [ ] **Step 9: Sign-off, then go live**
  - Owner confirms the Sheet copy looks exactly as expected after the steps above.
  - Take a fresh backup of the live Sheet (File, Make a copy).
  - Share the live Sheet with the service account. In Vercel, change `SHEET_ID` to the live Sheet's ID and, if the tab name differs, `SCHEDULE_TAB`. Redeploy.
  - Run `npm run recon` locally with `.env.local` pointed at the live Sheet and confirm "No problems found" before saving anything.
  - Log one real payment and check the Sheet. If anything looks wrong, remove the service account's access to the live Sheet and restore from the backup.

- [ ] **Step 10: Merge**

Merge the pull request to `main`. Vercel's production deploy now serves the live Sheet.

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| Month overview, card per portion, summary | 7, 15 |
| Log payment with prefilled amount, date received, automatic count | 9, 15 |
| New-cycle first payment with hike suggestion and "keep old rent" | 3, 7, 15 |
| New tenant (count restarts at 1, owner types rent) | 9, 15 |
| Vacant portion leaves cells blank | 9 (nothing is written), 6 (blank = no entry) |
| Settings page: names, cycle length, hike percent, never-resets | 8, 13, 16 |
| Overwrite protection | 9, 15 |
| Schedule layout untouched; month row cloned with formatting and total formula | 5, 9, 10 |
| Total as formula or value; Month as date or text | 4, 9, 12 |
| Settings and Payments Log tabs created on first run | 8 |
| Payments Log with date received; log-failure retry | 9, 15 |
| Never guess on structure change | 4, 6, 9, 12 |
| Google sign-in limited to one email; secrets in env | 11, 12, 13 |
| Stale-screen guard (re-read before write) | 9 (`load` runs inside `logPayment`) |
| Errors: save failure, header moved, duplicate, not signed in | 9, 10, 13, 15 |
| Unit tests for rules; fake-sheet tests; manual E2E on a copy | 3, 5 to 10, 18 |
| PWA install; Vercel deploy; SETUP.md | 14, 11, 17 |
| Open items (Month format, total formula, headers) | 12 (recon) |

**Placeholder scan:** no TBD or TODO. Every code step shows the full file. Owner-run steps (Google Cloud, Vercel, phone testing) give exact click paths and expected results.

**Type consistency:** `SheetsGateway.cloneRow(tab, fromRow, toRow, clearCols, overrides)` is the same in `gateway.ts`, `fake-gateway.ts`, `google-gateway.ts`, and `service.ts`. `SheetsContext`, `LogRow`, and `LogPaymentResult` are defined once in `service.ts` and used by the routes and `PaymentSheet`'s API contract (`logWritten`, `logRow`). `PortionCard` (`status`, `entry`, `next`) is produced by `deriveMonthView` and consumed by `PortionBoard` and `PaymentSheet`.
