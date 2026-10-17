# RentBook v1 wave 2: app feel (roadmap items 8 to 13)

> For agentic workers: implement task by task, test-first, with the gates below. One commit per task.

**Branch:** `v1-wave-2`, stacked on `v1-wave-1b`. **Roadmap:** `docs/product/ROADMAP-v1.md`, wave 2, items 8 to 13 only (brand identity; one design system; navigation and feedback; touch polish; plain wording and friendlier forms; a better Activity screen). **Tech:** Next.js 16.3.8, React 19, TypeScript strict, Tailwind 4.3, Vitest, zod.

**Goal:** RentBook should look and feel like one finished phone app: a real brand and icon set, one set of shared UI pieces, a bottom tab bar, a toast after every save, plain messages shown next to the field they are about, and an Activity screen that reads like a diary. The data, the Sheet layout, the API contracts (apart from friendlier error text and a new `details.field`) and the exit guard all behave as before.

**Out of scope:** offline shell, refresh control, desktop layout, vacancy handling, setup pages, receipts, the Config tab (wave 3 makes the name and accent configurable; this wave only puts them in one module), request ids on screen.

## Global constraints

- This is not the Next.js you know (`AGENTS.md`). Before using a Next API read its doc under `node_modules/next/dist/docs/` (each task names the ones it needs). `src/proxy.ts` is the old middleware.
- Writes to Google stay RAW. No real email address anywhere in the repo (example.com only). Never read or print secrets. Never run `npm run verify:testcopy`. No push to main, no deploy.
- NO new dependencies. No external fonts or icon packages (Geist via `next/font` stays as it is), no CSS framework beyond the installed Tailwind 4, no test library beyond Vitest. UI tests use `react-dom/server` renders and source reading (see `tests/server/ui-smoke.test.ts`, `tests/server/client-requests.test.ts`); browser checks may use the global Playwright (`/opt/node22/bin/playwright`, browsers in `/opt/pw-browsers`, Chromium) from a scratch dir, never added to `package.json`.
- Every task is test-first and ends with `npm test`, `npm run typecheck`, `npm run lint` and `env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npm run build` green (retry the build with `NODE_OPTIONS=--use-system-ca` if Google Fonts fails on a certificate). One commit per task; the message ends with a blank line and:
  `Claude-Session: https://claude.ai/code/session_01NEJMNwocTNcPN7LxPkW8Yx`
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Existing tests stay green. An old test changes only where a task below says the behaviour changes on purpose; say why in the commit body.
- The owner's live behaviour and data must not change except where a task says so. Keep the current Sheet layout, auth, every page dynamic (`getViewer()` calls `connection()`), and the nonce CSP in `src/proxy.ts`: no inline scripts, no `<style>` blocks; inline `style` attributes are allowed (`style-src-attr 'unsafe-inline'`), and so are inline `<svg>` elements.
- `src/lib/exit-guard.ts` and its tests (`tests/domain/exit-guard.test.ts`) are not touched. `ExitGuard.tsx` changes only its toast position classes (2-7).
- Plain English, phone first (360 to 430 px, thumb reach, 44 px targets), light and dark (the app follows `prefers-color-scheme`), accessible (labels, visible focus, contrast, `aria-live` for status). Pure logic goes in `src/lib` with unit tests; components stay thin.
- A client component that calls `useSearchParams` is always rendered inside `<Suspense>` with a fallback that renders the same control without the month (the build fails otherwise; see `use-search-params.md`).

Suggested sittings (one implementer each): 2-1 to 2-4, 2-5 to 2-7, 2-8 to 2-10, 2-11 to 2-13.

## What stays as it is (the owner's current look)

Colour values and their light and dark tokens; Geist; the single `max-w-md` column with a 16 px gutter; cards (`rounded-2xl border border-line bg-surface p-4`), controls (`rounded-xl`, 48 px submit buttons, 44 px others), pills (`rounded-lg`, success/warn/neutral tones); the month header (arrows, title with picker, Today pill), swipe between months, the pulse while a month loads; the month summary with its progress bar; the card content and buttons; the bottom-sheet shape of the payment, undo and month-picker dialogs; the exit guard; the tenant page layout. Changes the owner will notice: a tab bar replaces the footer links (which move to a new More screen), toasts after saves, focus rings and press feedback, a new icon and sign-in page, error text under the field, a few relabelled settings, and the Activity redesign.

---

### 2-1 Design tokens, base styles and the brand module

Files: `src/app/globals.css`, new `src/lib/brand.ts`, `src/app/layout.tsx`, `src/app/manifest.ts` (name and colours only), `src/lib/errors.ts`, `src/lib/sheets/schedule.ts`, `src/lib/sheets/settings-store.ts`, `src/app/signin/page.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/global-error.tsx`, `src/components/MonthPicker.tsx`, new `tests/domain/brand.test.ts`.

- `src/lib/brand.ts` (pure, no `server-only`, usable by client code): `BRAND = { name: "RentBook", shortName: "RentBook", tagline: "Rent receipts, straight into your own Google Sheet.", description: "Record monthly rent receipts into your Google Sheet.", colors: { accent: "#1f5f4a", accentInk: "#ffffff", background: "#f6f5f1", accentDark: "#6fc2a0", backgroundDark: "#121311" } } as const` and `getBrand()` returning it. Comment: wave 3 replaces the source of these values with the Config tab; callers must go through this module.
- Every user-visible "RentBook" in `src` comes from `BRAND.name` (metadata title, `appleWebApp.title`, manifest name and short name, sign-in heading and error, "Back to RentBook" on error and not-found pages, `<title>` in global-error, `crossOriginRequest`, the two sheet-structure messages). Manifest `background_color`/`theme_color` and the viewport `themeColor` read `BRAND.colors` (values unchanged).
- `globals.css`: keep every existing token and value. Add `--overlay` (light `rgb(0 0 0 / 0.4)`, dark `rgb(0 0 0 / 0.6)`), `--focus` (= `var(--accent)`), and in `@theme inline` `--color-overlay`, `--color-focus`, `--radius-card: 1rem`, `--radius-control: 0.75rem`, `--radius-chip: 0.5rem`. A comment block documents the scale the primitives use (type: `text-2xl` page/brand titles, `text-lg` screen titles and amounts, `text-base` body and every form control, `text-sm` secondary, `text-xs` pills; spacing: 16 px gutter, `space-y-3` between cards and fields, `mt-3`/`mt-4` between blocks).
- Base layer: one `:focus-visible` rule for `a, button, input, select, textarea, summary, [tabindex]`: `outline: 2px solid var(--focus); outline-offset: 2px`. `@utility press`: `transition: transform 120ms ease, opacity 120ms ease`, `&:active:not(:disabled) { transform: scale(0.98) }`, none of it under `prefers-reduced-motion: reduce`.
- `MonthPicker` backdrop `bg-black/40` becomes `bg-overlay` (the only colour outside the tokens).
- Tests: `BRAND` shape; the light and dark `--accent` and `--background` in `globals.css` equal `BRAND.colors` (parse the file); `globals.css` has the focus rule and the `press` utility with its reduced-motion guard; no string literal `"RentBook"` (or template text containing it) in `src/**/*.ts(x)` outside `src/lib/brand.ts` (comments ignored, reuse the comment/string scanner style of `tests/server/guards.test.ts`).
- Acceptance: nothing looks different except focus rings on keyboard focus.

### 2-2 Brand mark, icon set (with maskable), favicon, manifest

Read: `app-icons.md`, `generate-image-metadata.md`, `image-response.md`, `manifest.md`.
Files: new `src/lib/brand-mark.tsx`, new `src/components/ui/BrandMark.tsx`, `src/app/icon.tsx`, `src/app/apple-icon.tsx`, `src/app/manifest.ts`, `src/app/favicon.ico` (regenerated), new `scripts/make-favicon.ts`, `src/proxy.ts` (matcher), tests.

- The mark replaces the ₹ glyph (currency-neutral for wave 3): a house outline with two ledger lines, on a 32-unit grid, white strokes width 2.4, round caps and joins, no fill: `M7 15.5 L16 8 L25 15.5 V24.5 A1.5 1.5 0 0 1 23.5 26 H8.5 A1.5 1.5 0 0 1 7 24.5 Z`, `M11.5 18.5 H20.5`, `M11.5 22 H17.5`. `brandMarkSvg({ size, stroke, inset })` returns the `<svg>` element (plain JSX, no hooks) so `ImageResponse` and the React component draw the same geometry; `inset` widens the viewBox (`-4 -4 40 40`, 80 %) for full-bleed icons so the mark sits inside the maskable safe circle.
- `BrandMark` (component): `aria-hidden` svg using `currentColor`, size prop, for the sign-in page and the More screen.
- `icon.tsx`: `generateImageMetadata` with ids `"32"`, `"192"`, `"512"` (PNG); each draws an accent rounded square (corner radius 22 % of the size, transparent outside) with the mark. `apple-icon.tsx`: ids `"180"` and `"512"`, full-bleed accent square, inset mark. The `apple-icon` 512 doubles as the maskable icon (a full-bleed, safe-zone design is what both need), so no new open route is needed. Confirm the generated URLs (`/icon/32` ..., `/apple-icon/512`) in the build's route list.
- Manifest: add `id: "/"`, `scope: "/"`, `lang: "en"`; icons exactly `[{ src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/apple-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" }]`.
- Favicon: the current `favicon.ico` is create-next-app's default (sha256 `2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932`).
  - `scripts/make-favicon.ts` (run with `npx tsx`, documented at its top, not an npm script) gets the 32 px PNG by calling the `icon.tsx` default export with `{ id: Promise.resolve("32") }`; if `next/og` cannot run outside Next, it fetches `/icon/32` from a local `next start` instead.
  - It exports `packIco(pngs: { size: number; bytes: Uint8Array }[]): Uint8Array` (ICONDIR + one ICONDIRENTRY per PNG + the PNG bytes; modern browsers read PNG-in-ICO) and writes `src/app/favicon.ico`. Commit the regenerated file.
- Proxy matcher: also skip `/icon/<id>` and `/apple-icon/<id>` (`(?:icon|apple-icon)(?:/[^/]+)?$`). Deliberate test change in `tests/server/proxy.test.ts`: add `/icon/32` and `/apple-icon/512` to "does not run"; `/iconography` still runs.
- Tests: `generateImageMetadata` ids and sizes for both files; `manifest()` exact icons, `id`, colours from `BRAND`; `packIco` header (`00 00 01 00`, count, sizes, offsets) on two fake PNGs; the committed `favicon.ico` is an ICO whose first image starts with the PNG signature and whose sha256 is not the default's; `BrandMark` renders an `aria-hidden` svg with `stroke="currentColor"`. If `ImageResponse` renders under Vitest, also assert the 512 icon is `image/png` with a 512x512 IHDR; if not, that check moves to 2-13.
- Acceptance: the browser tab, the home-screen icon (Android maskable and iOS) and the install prompt all show the new mark; no Next.js default artwork is left.

### 2-3 Shared primitives

Files: new `src/lib/ui-classes.ts`, new `src/components/ui/` files: `Button.tsx` (`Button`, `ButtonLink`), `SubmitButton.tsx`, `Field.tsx` (`Field`, `Input`, `Select`, `TextArea`, `Checkbox`), `Notice.tsx` (`Notice`, `LiveNotice`), `Pill.tsx`, `Card.tsx`, `Spinner.tsx`, `Skeleton.tsx`, `EmptyState.tsx`, `Page.tsx`, `PageHeader.tsx`; new `tests/server/ui-primitives.test.ts`, `tests/domain/ui-classes.test.ts`.

- `src/lib/ui-classes.ts` (pure) holds the class strings, taken from today's screens so nothing moves:
  - `buttonClasses(variant, size)`: base `press inline-flex items-center justify-center gap-2 rounded-xl px-4 font-medium disabled:opacity-60`; sizes `lg` = `min-h-12`, `md` = `min-h-11`; variants `primary` (`bg-accent text-accent-ink`), `secondary` (`border border-control`), `danger` (`bg-danger-bg text-danger-ink`), `dangerText` (`text-danger-ink underline`), `quiet` (`text-muted`).
  - `FIELD_CONTROL` = `mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base` (TextArea adds `py-2` and drops the min height; the amount input may pass `text-lg`).
  - `noticeClasses(tone)` = `rounded-lg px-3 py-2 text-sm` + `bg-<tone>-bg text-<tone>-ink` for `success | warn | danger`; `pillClasses(tone)` = `shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium` + tone (`neutral` = `bg-line text-foreground`).
  - `CARD` = `rounded-2xl border border-line bg-surface p-4`; `SKELETON_BAR` = `rounded-lg bg-line animate-pulse motion-reduce:animate-none`.
- `Button`: `variant`, `size`, `pending`, `pendingLabel`; pending shows `Spinner` and `pendingLabel`, sets `disabled` and `aria-busy`. Callers may add layout classes only (`w-full`, `flex-1`, margins). `ButtonLink` is a `next/link` with the same looks. `SubmitButton` (client) uses `useFormStatus` for server-action forms (sign-in, sign-out).
- `Field` (client, `useId`): `label`, `hint?`, `error?`, one control child; wires `id`, `aria-describedby` (hint and error), `aria-invalid`; the error renders under the control as `<p class="mt-1 text-sm text-danger-ink">`. Controls use `FIELD_CONTROL`. `Checkbox` is a full-row `min-h-11` label with a `size-5` box.
- `Notice` (`tone`, `role?`), `LiveNotice` (always-present `role="status"` wrapper that gets the tone classes only while it has content: the pattern `PaymentSheet` uses today). `Pill`, `Card` (`as` prop), `Spinner` (inline svg, `motion-safe:animate-spin`, `aria-hidden`), `Skeleton`, `EmptyState` (`title`, text, optional action).
- `Page` (`<main>`: `mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4`; 2-6 swaps `pb-10` for `pb-tabbar` on screens with the tab bar; `center` variant for sign-in and error pages: `flex flex-col justify-center`, keeps `pb-10`). `PageHeader` (`title`, `back?: { href, label }`): the current `‹` link (`grid min-h-11 min-w-11 place-items-center rounded-lg text-xl`) and `h1 text-lg font-semibold`.
- Tests: class functions per variant and tone; each primitive renders with its role and attributes (Field ids wired, `aria-invalid` only with an error, pending Button disabled with `aria-busy` and the pending label, LiveNotice empty wrapper has no tone classes); every Button and ButtonLink size has `min-h-11` or `min-h-12`.
- Acceptance: primitives exist and are tested; no screen uses them yet, so nothing on screen changes.

### 2-4 Bottom Sheet; PaymentSheet, UndoSheet and MonthPicker on it

Files: new `src/components/ui/Sheet.tsx`, `PaymentSheet.tsx`, `UndoSheet.tsx`, `MonthPicker.tsx`, `globals.css`, tests.

- `Sheet` props: `labelledBy`, `describedBy?`, `onClose`, `canClose` (false while busy), `closeOnBackdrop` (MonthPicker true; the payment and undo sheets false, as today, so typed values are never lost to a stray tap), `initialFocus?` ref, `children`. It renders the backdrop (`fixed inset-0 z-40 flex items-end justify-center bg-overlay`) and the panel (`role="dialog" aria-modal="true"`, `max-h-dvh w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-5 pb-safe`, a 4 x 36 px `bg-line` grab bar on top, `aria-hidden`).
- Behaviour moved in from the three dialogs:
  - Escape closes when `canClose`; the backdrop closes only through `shouldCloseOnBackdrop` (`src/lib/month-nav.ts`, reused, not moved).
  - Tab stays inside the panel (`trapTabIndex` over all enabled focusable elements, not only buttons).
  - On open, focus goes to `initialFocus`, else stays where an `autoFocus` control put it, else the panel. On close it returns to the opener if that is still connected. Capture the opener in a lazy `useState` initialiser (render time, before `autoFocus` moves focus; an effect would capture the autofocused input instead).
  - While open, `html` gets the class `sheet-open` (`globals.css`: `html.sheet-open, html.sheet-open body { overflow: hidden }`), so the page behind does not scroll. `@utility pb-safe { padding-bottom: max(1.25rem, env(safe-area-inset-bottom)) }`.
- The panel keeps `role="dialog"`, so `MonthFrame` still blocks swipes while any sheet is open. UndoSheet keeps its safe-button focus rules (Keep, then Close, then Retry) via `initialFocus` and its effect; MonthPicker keeps its focus-the-panel behaviour.
- The dialogs' inner buttons, notices and fields move to the 2-3 primitives in this task. `PaymentSheet` keeps the details/summary box (`group ... border-control`, chevron, `min-h-11`) as it is.
- Tests: Sheet renders the dialog roles and labels, the panel classes include `overscroll-contain` and `pb-safe`; source test that the three dialogs import `Sheet` and contain no `fixed inset-0`; the existing PaymentSheet and UndoSheet smoke tests stay green unchanged.
- Acceptance: the three dialogs look as before (plus the grab bar) and behave as before; Tab no longer escapes the payment and undo sheets; the page behind a sheet does not scroll.

### 2-5 Migrate the other screens; branded sign-in page

Files: `PortionBoard.tsx`, `TenancyForm.tsx`, `MoveOutForm.tsx`, `SettingsForm.tsx`, `LoadProblem.tsx`, `src/app/page.tsx`, `activity/page.tsx` (primitives only; redesign in 2-12), `settings/page.tsx` (its inline problem becomes `LoadProblem`), `tenants/[portionId]/page.tsx`, `tenants/[portionId]/loading.tsx`, `error.tsx`, `not-found.tsx`, `signin/page.tsx`, new `tests/server/design-system.test.ts`.

- Replace the ad-hoc class strings with the primitives. Keep what tests pin: the amount line `<p class="mt-2 text-lg font-medium">`, the Details link `min-h-11`, the summary section's `ring-1 ring-line`, the tenant `Detail` rows. The card pills use `Pill` (labels Paid, Pending, No tenant unchanged); tenancy chips use `Pill tone="neutral"`.
- Sign-in page (`Page center`), top to bottom:
  - `BrandMark` 56 px in accent; an `h1` wordmark (`BRAND.name`, `text-2xl font-semibold tracking-tight`); `BRAND.tagline` (muted);
  - "Sign in with the Google account the owner added."; a `SubmitButton` "Sign in with Google" (pending "Opening Google…"); a muted footnote "Your records stay in your own Google Sheet."
  - errors (Notice danger, `role="alert"`): `AccessDenied` → "That Google account isn't on the list for {name}. Ask the owner to add it, or sign in with another account."; `Configuration` → "Sign-in isn't set up correctly. If you are the owner, check the sign-in settings in SETUP.md."; anything else → "Sign-in didn't work. Try again."
  - no Google logo is drawn (Google's brand rules); the button stays text.
- `tests/server/design-system.test.ts` (source scan of `src/app/**/*.tsx` and `src/components/**/*.tsx`, comments ignored): no hex, `rgb(`/`hsl(` colours or Tailwind palette colour classes (`bg|text|border|ring|fill|stroke` + `black|white|gray|red|...`); the primitive-only patterns (`bg-accent px-4 font-medium text-accent-ink`, `border border-control bg-surface px-3`, `fixed inset-0`, `rounded-lg bg-danger-bg px-3 py-2`, `rounded-lg px-2.5 py-0.5 text-xs`) appear only under `src/components/ui/` or `src/lib/ui-classes.ts`; no raw `<input`, `<select` or `<textarea` outside `src/components/ui/`. Sign-in tests: the three error texts, the button, the tagline.
- Acceptance: every screen except sign-in looks the same as before (side-by-side screenshots in the commit body are welcome, not required); the guard test passes.

### 2-6 Navigation: tab bar, More screen, back that keeps the month

Read: `link.md`, `use-link-status.md`, `use-pathname.md`, `use-search-params.md`, `use-router.md`, `layout.md`.
Files: new `src/lib/app-nav.ts`, new `src/components/TabBar.tsx`, new `src/components/ui/BackLink.tsx`, `PageHeader.tsx`, `src/app/layout.tsx`, new `src/app/more/page.tsx`, `src/app/page.tsx`, `PortionBoard.tsx`, tenants page, `src/lib/tenancy-response.ts`, `TenancyForm.tsx`, `MoveOutForm.tsx`, `settings/page.tsx`, `globals.css`, `README.md`, tests.

- `src/lib/app-nav.ts` (pure):
  - `monthParam(value)`: a valid `YYYY-MM` or null (via `parseYmKey`). `withMonth(path, monthKey | null)`: adds or replaces `month=`. `monthScreenHref(monthKey | null)`: `/?month=K` or `/`.
  - `TABS`: Month (`/`), Activity (`/activity`), More (`/more`). `tabForPath(pathname)`: `/` and `/tenants/*` → month; `/activity` → activity; `/more` and `/settings` → more; anything else (sign-in, not-found) → null, and then no bar is shown.
  - `navAction({ fromPath, to, previousUrl })` → `"none" | "back" | "push" | "replace"`: already on the target's root → none; the previous history entry's path is the target's root → back; leaving the month screen → push; otherwise replace, so the stack stays "month screen, one other screen".
  - `previousUrl` comes from the Navigation API (`navigation.entries()[navigation.currentEntry.index - 1]?.url`, read in a try/catch). It is null where the API is missing (Firefox); the fallback is then a replace to the href that carries the month.
- `TabBar` (client, rendered once in the root layout inside `<Suspense>`; the fallback is the same bar with month-less hrefs):
  - fixed bottom `nav aria-label="Main"`, `z-30`, `bg-surface border-t border-line`, height `var(--tabbar-h)` (`4rem`, links `min-h-16`) plus `env(safe-area-inset-bottom)`; three equal links, each an inline-svg icon (calendar, list, three dots, drawn here) over a label; `aria-current="page"` and accent colour on the active tab; hidden when `tabForPath` is null.
  - hrefs carry the month from `useSearchParams()`. A click follows `navAction`: back → `router.back()`; replace → `router.replace(href)`; push → the Link itself; none → scroll to the top.
  - a fixed-size pending dot (opacity only: `useLinkStatus` for Link navigations, `useTransition` for replace) shows while the next screen loads.
- `BackLink` (client, in `<Suspense>`): `PageHeader`'s `‹`, same `navAction` rule for its target; tenant page and its loading screen → month (`aria-label="Back to month"`, kept), settings → More (`aria-label="Back to More"`). Without a month it links to `/` exactly as today.
- Month carried as `?month=`: PortionBoard's Details link → `/tenants/p1?month=2026-10` (deliberate change to the two `href="/tenants/p1"` assertions in `ui-smoke.test.ts`); the tenant page reads `monthParam` and passes `monthKey` to `TenancyForm`/`MoveOutForm`; `tenantsPagePath`, `changedPagePath`, `pageAfterSave`, `pageAfterConflict` take an optional month and keep it.
- `/more` (`getViewer` + redirect, no Sheet read so no `maxDuration`): `PageHeader` "More" (no back); Account card "Signed in as {email}" with a Pill "Owner" or "Member"; for the owner a row link "Portion settings" (hint "Cycle lengths and hike percentages", carries the month); Sign out (`SubmitButton` secondary, pending "Signing out…"); About line: `BrandMark`, `BRAND.name`, "Version {package.json version}". The home page footer (signed in as, Activity, Portion settings, Sign out) is removed; its content now lives in the tab bar and on More.
- Every `Page` that shows the bar gets `pb-tabbar` (`@utility pb-tabbar { padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 1.5rem) }`).
- Exit guard: switching tabs from the month screen is a click, so the guard arms before the Link pushes, exactly as the footer links did; going back uses `history.back()` onto the guard's sentinel, which the guard already handles ("a return from another page"). Do not change `exit-guard.ts`.
- README: replace the paragraph "Switching months does not add browser history ..." middle sentences with the new rule (tabs, Back returns to the month that was showing) and keep the exit-guard text.
- Tests: `app-nav` unit tests for every rule, including `previousUrl` null and a previous entry with a different month; TabBar render (mock `usePathname`, `useSearchParams`, `useRouter`; add the first two to the existing `next/navigation` mocks wherever `BackLink` now renders, so tests do not pass on a Suspense fallback by accident): three links, active `aria-current`, hrefs carry the month, hidden on `/signin`; More page tests (owner sees Portion settings, member does not, stranger redirected); `tenancy-response` tests for month-keeping paths; proxy test adds `/more` to "runs on"; guards test passes with the new page.
- Acceptance: from any month, Details, Activity or More and back (by `‹`, the Month tab or the system Back) shows the same month; the exit-guard tests are untouched and green.

### 2-7 Feedback: toasts on every write, pending states, loading skeletons

Read: `loading.md`, `instant-navigation.md`.
Files: new `src/components/ui/Toast.tsx`, `src/app/layout.tsx`, new `src/lib/toast-copy.ts`, `PortionBoard.tsx`, `PaymentSheet.tsx`, `UndoSheet.tsx`, `SettingsForm.tsx`, `TenancyForm.tsx`, `MoveOutForm.tsx`, `ExitGuard.tsx` (classes only), `globals.css`, new `src/app/activity/loading.tsx`, new `src/app/settings/loading.tsx`, `tenants/[portionId]/loading.tsx`, tests.

- `ToastProvider` in the root layout (around `children`, so a toast survives `router.refresh()` and `router.replace()`); `useToast().show(text)` (a no-op outside the provider, so server renders and tests work). One always-present `role="status"` region, `pointer-events-none fixed inset-x-4 z-50 mx-auto max-w-md bottom-toast`; a toast lasts 4 s, a new one restarts the timer (the id rule from PortionBoard). `@utility bottom-toast { bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 0.75rem) }`, `bottom-toast-high` 3.5rem higher for ExitGuard. PortionBoard's own toast state and region go.
- `toast-copy.ts` (pure):
  - log "{portion}: {₹ amount} logged for {Month YYYY}"; edit "{portion}: amount changed to {₹ amount}"; Replace after a duplicate warning "{portion}: amount replaced with {₹ amount}"; new tenant "{portion}: {tenant} added, {₹ amount} logged";
  - undo keeps `undoToastText` ("{portion}: payment undone"); settings "Settings saved"; tenancy create or edit "Details saved"; move-out "{tenant} has moved out".
  - A sheet that stopped on a notice (log entry or tenancy details not saved) shows its toast when it finally closes (retry success or Skip), as the undo sheet does today.
- Pending: every write disables its form (`<fieldset disabled>` around the fields) and shows the Button pending state ("Saving…", "Undoing…", "Retrying…" as now); SettingsForm's inline "Saved" goes (toast instead, errors stay inline); TenancyForm keeps the create-form status "Saved. Updating the page…" and drops the edit form's green "Saved." box (toast instead).
- Loading skeletons: `activity/loading.tsx` (header "Activity", a chip row and three entry cards) and `settings/loading.tsx` (header with back to More, two fieldset cards); the tenants one uses `Skeleton`/`PageHeader`/`BackLink`. Each: `aria-busy="true"`, an `sr-only` "Loading …" line, every pulse with its reduced-motion fallback. No root `src/app/loading.tsx`: it would replace the month screen (and its header) with a skeleton on every month switch, where the current pulse keeps the asked-for month on screen. Going back to the month screen is instant from the router cache; the tab's pending dot covers the rest.
- Deliberate test changes in `ui-smoke.test.ts`: ExitGuard sits at `bottom-toast-high` and the shared region at `bottom-toast` (instead of `bottom-20`/`bottom-4` on PortionBoard).
- Tests: every `toast-copy` text; Toast region always present and empty at first render; the components call `useToast().show` with the copy functions (source test); skeleton tests like the existing tenants one.
- Acceptance: every write ends in a toast or an inline message, never in silence; no field can be edited while its save is in flight.

### 2-8 Touch polish

Read: `generate-viewport.md`.
Files: `src/app/layout.tsx`, `globals.css`, `Page.tsx`, `TabBar.tsx`, `Sheet.tsx`, `MonthFrame.tsx` (classes only), new `tests/support/tap-targets.ts`, tests.

- Viewport: keep `width`, `initialScale`, `interactiveWidget`; add `viewportFit: "cover"`, `colorScheme: "light dark"`, `themeColor: [{ media: "(prefers-color-scheme: light)", color: BRAND.colors.accent }, { media: "(prefers-color-scheme: dark)", color: BRAND.colors.backgroundDark }]`. Never set `maximumScale` or `userScalable` (pinch zoom stays). `appleWebApp.statusBarStyle` stays `default`.
- `globals.css` base:
  - `html { background: var(--background); -webkit-text-size-adjust: 100%; touch-action: manipulation; -webkit-tap-highlight-color: transparent }`: no double-tap zoom delay, no colour flash at the scroll edges, and `press` replaces the grey tap flash.
  - `@media (display-mode: standalone) { html, body { overscroll-behavior-y: none } }`: no rubber-band in the installed app; a browser tab keeps pull-to-refresh.
  - buttons and the tab bar: `user-select: none; -webkit-touch-callout: none`.
- Safe areas: `Page` top `max(1rem, env(safe-area-inset-top))` and sides `max(1rem, env(safe-area-inset-left/right))` (utilities `pt-safe`, `px-safe`); the tab bar and sheets pad the bottom inset (2-4, 2-6); toasts sit above the bar (2-7).
- Press states: every Button, the tab links, the month arrows and title button, picker cells and filter chips carry `press`. Focus: the global ring from 2-1 is visible on all of them (check the dark theme too).
- 44 px audit: `tests/support/tap-targets.ts` `smallTargets(html)` lists every `<button>` and `<a>` whose class has none of `min-h-11`, `min-h-12`, `min-h-16`, `h-11`, `h-12`, `size-11`, `size-12`. A test runs it on rendered PortionBoard, PaymentSheet (all modes), UndoSheet, TenancyForm, MoveOutForm (open), SettingsForm, LoadProblem, More, sign-in, TabBar and the Activity page; fix any it finds. Another asserts every form control class contains `text-base` or `text-lg` (no iOS zoom on focus).
- Tests: the viewport export; the CSS rules above exist.
- Acceptance: `smallTargets` is empty for every screen tested; pinch zoom still works; nothing sits under the notch or the home indicator.

### 2-9 Plain server messages; no field paths in errors

Files: `src/lib/errors.ts`, `src/lib/server/http.ts`, new `src/lib/field-labels.ts`, `src/lib/server/schemas.ts`, `src/lib/domain/input-rules.ts`, `src/lib/sheets/service.ts`, `src/lib/sheets/tenancy-service.ts`, tests.

- `validation(message, field?)`: with a field the error carries `details: { field }` (API answers then include it).
- `parseBody`: no `path: ` prefix any more. A `custom` issue (every `safeText`/`isoDay` message already names its field) keeps its message; any other issue becomes "{Label} isn't valid." using `FIELD_LABELS` (last path segment: `amount` Amount, `dateReceived` Date received, `newTenantName` Tenant name, `month` Month, `portionId` Portion, `phone`, `moveIn` Move-in date, `agreementEnd`, `advance`, `advanceDate`, `notes`, `moveOut` Move-out date, `refund`, `deductions`, `name` Portion name, `cycleLength` Payments per cycle, `hikePercent` Hike), else "Something in that request isn't valid. Reload the page and try again." Either way the issue path (`fields.phone`, `portions.0.name`) goes into `details.field`.
- Wording changes (update the tests that pin the old text, deliberately):

  | Where | Now | New |
  | --- | --- | --- |
  | `schemas.ts` month | `month must look like 2026-10` | That month isn't valid. Open it again from the month screen. |
  | `readJsonBody`, `unsupportedMediaType` | Request body must be JSON. / That request wasn't sent as JSON. | That request couldn't be read. Reload the page and try again. (400 and 415 kept) |
  | `tenancyBody` refine, `tenancy-service.ts` | `expectedUpdatedAt is required when id is given` / Updating a tenancy (Moving out) needs the updated-at value the person saw. | This page is out of date. Refresh it and try again. |
  | `service.ts`, `tenancy-service.ts` | `Unknown portion "p9".` | That portion isn't in your Settings any more. Refresh the page. (the tenants page still turns this validation error into a 404) |
  | duplicate conflict | X already has ₹5450 recorded for 2026-10. | X already has ₹ 5,450 recorded for October 2026. (`formatRupees`, `formatMonthTitle`; details unchanged) |
  | `dayProblem` | {Label} must be a real date (YYYY-MM-DD). | {Label} isn't a real date. |
  | `handle()` unknown error | Something went wrong. Try again. | Something went wrong on our side. Try again. |
- Fields on service errors: the amount range error (`amount`), "This portion has no tenant yet. Enter a tenant name." (`newTenantName`), "Move-out date cannot be before the move-in date." (`moveOut`).
- Tests: `http.test.ts` "reports the first problem with its field name" becomes "reports the first problem in plain words, with its field in details" (deliberate); one test per new label rule and per changed message; the route tests see `details.field` in a 400 answer. `schemas.test.ts` keeps its own `path: message` helper; only the date-message lines change.
- Acceptance: no API error text a person can see contains a field path, `JSON`, `id`, `updated-at` or an ISO month.

### 2-10 Friendlier forms: messages next to the field, input hints, timeouts

Files: `src/lib/post-json.ts`, new `src/lib/request-copy.ts`, `src/lib/payment-request.ts`, `src/lib/tenancy-input.ts`, `src/lib/settings-input.ts`, new `src/lib/form-errors.ts`, the five form components, `tests/server/client-requests.test.ts`, tests.

- `sendJson<T>(url, payload, { timeoutMs, method })` → `{ kind: "answer"; body: T } | { kind: "offline" } | { kind: "timeout" } | { kind: "no-answer" }`; `offline` when `navigator.onLine === false` before sending (nothing is sent). `postJson` stays as a thin wrapper (its tests stay). The five components call `sendJson`; `client-requests.test.ts` accepts `sendJson` or `postJson` from `@/lib/post-json` and still forbids `fetch` (deliberate).
- `request-copy.ts`: offline "You're offline, so nothing was sent. Connect to the internet and try again."; timeout "No answer after 30 seconds. It may still have saved: refresh the page and check before trying again."; no-answer keeps today's texts (`NO_CONFIRMATION`, `TENANCY_NO_CONFIRMATION`, `LOG_RETRY_UNCONFIRMED_MESSAGE`); `apiErrorMessage(error)`: `unauthorized` → "You've been signed out. Reload the page to sign in again.", missing or `internal` → "Something went wrong on our side. Try again.", else the server text. A slow hint under the submit button after 8 s of pending: "Still working. Google can take a few seconds." (`LiveNotice`).
- Field-level validation in the pure builders, which now return `{ ok: false, message, field }`:
  - `buildPaymentRequest`: a blank amount → "Enter the amount received."; text such as "5k" → "Enter the amount as a whole number." (field `amount`); a blank new-tenant name → "Enter the new tenant's name." (field `tenantName`, caught before sending).
  - `newTenantDetails`, `buildTenancyRequest`, `buildMoveOutRequest`: fields `advance`, `moveIn`, `moveOut`, `refund`, `deductions` (messages unchanged).
  - `parseSettingsRows` → `{ ok: false, message, rowId, field: "name" | "cycle" | "hike" }`: "Portion name must be 1 to 60 characters."; "Payments per cycle must be a whole number from 1 to 120. To stop the count resetting, tick "Count never resets"."; "Hike must be a number from 0 to 100. Use a dot for decimals, like 5.5." (deliberate change to the `settings-input` tests that pin the `p4:`/`Attic:` prefixes: the field now says where).
  - `form-errors.ts` maps a server `details.field` to a form field: `amount`; `dateReceived` → `date`; `newTenantName` → `tenantName`; `tenancy.X` and `fields.X` → `X`; `portions.N.name|cycleLength|hikePercent` → row N `name|cycle|hike`; anything else → no field.
- Components: errors with a field show in that `Field` (`aria-invalid`, described by), the first invalid field gets focus, the New tenant sheet opens its details box when the field is inside it; errors without a field stay in the form's alert Notice. Forms get `noValidate` (no browser bubbles); `required`/`aria-required` stay for meaning. Typing in a field clears its error.
- Settings labels: "Name" → "Portion name"; "Cycle length" → "Payments per cycle" with hint "After this many payments the count starts again at 1 and the hike is added."; "Hike %" → "Hike at each new cycle (%)"; "Count never resets" stays. PaymentSheet submit "Save to sheet" → "Save to Sheet".
- Input hints: amount `inputMode="numeric" enterKeyHint="done" autoComplete="off"`; tenant name `autoComplete="off" autoCapitalize="words" spellCheck={false} enterKeyHint="next"`; phone `type="tel" autoComplete="off"` (a tenant's number, not the user's); rupee fields `inputMode="numeric" autoComplete="off"`; cycle `inputMode="numeric"`, hike `inputMode="decimal"`; portion name `autoCapitalize="words" autoComplete="off"`; notes `autoCapitalize="sentences"`; dates stay `type="date"`.
- Tests: `sendJson` each kind with a stubbed `fetch`/`navigator` and fake timers; `request-copy` texts; builder `field` results; `form-errors` mapping; render tests: a Field with an error has `aria-invalid="true"` and the message id in `aria-describedby`; the forms have `novalidate`; the attribute table above (source or render test).
- Acceptance: a wrong value shows its message under its field (whether the browser or the server found it); offline, timeout and signed-out cases each say what happened and what to do.

### 2-11 Activity data: entries, days and filters (pure)

Files: new `src/lib/activity-view.ts`, `src/lib/format.ts` (`formatTime`, `indiaDayKey`), tests `tests/domain/activity-view.test.ts`, `tests/domain/format.test.ts`.

- `indiaDayKey(iso)` → `YYYY-MM-DD` in Asia/Kolkata (null for an unreadable time); `formatTime(iso)` → "10:00 am"; `dayHeading(dayKey, todayKey)` → "Today", "Yesterday", "Wednesday, 14 October" (same year) or "14 October 2025".
- `toActivityEntry(item, viewerEmail)` → `{ portion, tone, label, summary, amount, struck, meta }`:

  | Action | Pill (tone) | Summary |
  | --- | --- | --- |
  | Logged | Logged (success) | Logged {₹ amount} from {tenant} for {Month YYYY} (payment {n}). |
  | Edited | Changed (warn) | Changed {tenant}'s {Month YYYY} payment to {₹ amount}. |
  | Undone | Undone (danger) | Undid {tenant}'s {Month YYYY} payment of {₹ amount}. (amount struck through, sr-only "removed") |
  | none (old row) | Entry (neutral) | {₹ amount} from {tenant} for {Month YYYY}. |

  Missing parts (amount, count, tenant) are left out without stray punctuation. `meta`: "{time} · by you" for the viewer's own address (case-insensitive), "{time} · by {address}" for others, "{time} · who: not recorded" when blank; Logged and Changed add " · received {d Mon}" when `dateReceived` is a real day.
- `groupByDay(entries, now)` keeps the newest-first order and returns `{ key, heading, entries }[]`; rows with an unreadable time go in a last group "Date not recorded".
- Filters: `ACTIVITY_SCAN_LIMIT = 500`, `ACTIVITY_SHOWN_LIMIT = 50`; `parseActivityFilters(searchParams)` → `{ show: "all" | "logged" | "edited" | "undone"; portion: string | null }` (unknown values fall back to all); `filterActivity(items, filters)`; `portionsIn(items)` (distinct names in first-seen order); `activityHref(filters, monthKey)` (keeps `month`, drops defaults).
- Tests: India midnight boundary (`2026-10-15T19:00:00Z` is Today on `2026-10-16`), Yesterday, other year; every action's copy, including missing parts and an old row; "by you" case-insensitive; filters and hrefs.
- Acceptance: pure module only; the page is unchanged until 2-12.

### 2-12 Activity screen

Files: `src/app/activity/page.tsx`, `src/app/activity/loading.tsx`, `tests/server/activity-page.test.ts` (new), `tests/server/page-freshness.test.ts`, `tests/server/page-problems.test.ts`.

- The page takes optional `searchParams` (existing tests that call `ActivityPage()` keep working), reads `readActivity(ctx, ACTIVITY_SCAN_LIMIT, { minFetchedAt })` (deliberate change: the freshness test expects 500 instead of `undefined`), filters, keeps the newest 50 and groups by day.
- Layout: `PageHeader` "Activity" (a tab root, no back); two horizontally scrolling chip rows of `ButtonLink`-style 44 px chips (`aria-current` on the chosen one, links replace and keep the scroll): All, Logged, Changed, Undone; then All portions plus each portion name. Each day is an `<h2>` (`text-sm font-medium text-muted`, sticky under the top inset) followed by an `<ol>` of `Card`s: portion (font-medium) and `Pill`, the summary sentence, the amount (`text-lg font-medium`, struck for Undone), the meta line (muted, `break-words`).
- States: no rows at all → `EmptyState` "Nothing logged yet" / "Payments you log, change or undo show up here, newest first."; filters match nothing → "No entries match these filters." with a "Show everything" link; more than 50 match → a muted line at the end "Showing the newest 50. Older entries are in the Payments Log tab of your Sheet."; read failure → `LoadProblem` as now (retry keeps the filters).
- Skeleton updated to match (chip row, a day heading, three cards).
- Tests: grouping headings render in order; the three action texts and pills; "by you"; a filter link set; the three states; tap targets via `smallTargets`; the page-problems test still sees the problem block.
- Acceptance: a person can answer "who undid what, when, and for how much" from the screen alone; the Payments Log tab is only read, as before.

### 2-13 Verify

1. `npm test`, `npm run typecheck`, `npm run lint`, `env -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET npm run build`; working tree clean; note the test count before and after.
2. `next start` smoke from a scratch copy (outside the repo; symlink `node_modules`): replace the gateway in `src/lib/server/context.ts` with a `FakeGateway` seeded from `tests/support/fixtures.ts` (two paid portions, one pending, one with no tenant, a Payments Log with Logged, Edited and Undone rows over three days), build, start with dummy values (`AUTH_SECRET` of 32+ characters, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` dummies, `ALLOWED_EMAILS=owner@example.com,member@example.com`, `SHEET_ID` dummy, `GOOGLE_SERVICE_ACCOUNT_JSON` a dummy object). Mint a session cookie with `encode` from `@auth/core/jwt` (salt and cookie name `authjs.session-token`, include `issuedAt`). Check: `/manifest.webmanifest` JSON; `/icon/32`, `/icon/192`, `/icon/512`, `/apple-icon/180`, `/apple-icon/512` are `image/png` with the right IHDR size; `/favicon.ico`; CSP header present on pages and absent on icons.
3. Playwright (Chromium, 390 x 844, light and dark), screenshots saved in the scratch dir: `/signin` (and `?error=AccessDenied`), `/` (current month, and `?month=` another month), the Log payment sheet, the New tenant sheet with a field error, the Undo sheet, the month picker, a toast after logging, `/activity` (all, and filtered to Undone), `/more` as owner and as member, `/settings` with a field error, `/tenants/p1`, and the Activity loading skeleton (delay the fake gateway). Collect console CSP violations (must be none). Walk: month → switch to a past month → Details → `‹` returns to that month; → Activity tab → Month tab returns to that month; Back from the month screen leaves the app's history as before (in a normal tab the guard is off).
4. README feature bullets match the new screens (tab bar, More, Activity by day); no other docs change.
5. Report: test count, every deviation from this plan, every deliberate test change, and what could not be verified (the exit guard in an installed Android app, iOS safe areas and status bar, a real maskable crop, real Google latency).
