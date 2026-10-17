import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import type { ActivityItem } from "@/lib/sheets/service";
import { smallTargets, smallTextControls, unpressedTargets } from "../support/tap-targets";
import { withoutComments } from "../support/source-scan";

// Touch polish: the viewport, the base styles, the safe areas, and an audit of every screen for what a thumb needs: a
// tap target of 44 px, text that does not make the phone zoom in, and feedback while a button is held down.

const state = vi.hoisted(() => ({
  pathname: "/",
  // See renderOpen: the first useState of a component, forced to true for one render.
  openFirst: false,
  stateCalls: 0,
  getViewer: vi.fn(),
  readActivity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(""),
}));
// The real font loader only works inside a Next build; the layout is imported here only for its viewport.
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "--font-geist-sans" }) }));
vi.mock("@/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: state.getViewer }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => ({}) }));
vi.mock("@/lib/server/freshness", () => ({ readWrittenAt: async () => undefined }));
vi.mock("@/lib/sheets/service", () => ({ readActivity: state.readActivity }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) => {
      state.stateCalls += 1;
      if (state.openFirst && state.stateCalls === 1) return [true, () => {}];
      return actual.useState(initial);
    }) as unknown as typeof actual.useState,
  };
});

import ActivityPage from "@/app/activity/page";
import { metadata, viewport } from "@/app/layout";
import MorePage from "@/app/more/page";
import SignInPage from "@/app/signin/page";
import LoadProblem from "@/components/LoadProblem";
import MoveOutForm from "@/components/MoveOutForm";
import PaymentSheet from "@/components/PaymentSheet";
import PortionBoard from "@/components/PortionBoard";
import SettingsForm from "@/components/SettingsForm";
import TabBar from "@/components/TabBar";
import TenancyForm from "@/components/TenancyForm";
import UndoSheet from "@/components/UndoSheet";
import { BRAND } from "@/lib/brand";
import { emptyMoveOutForm, emptyTenancyForm } from "@/lib/tenancy-input";
import { pageClasses } from "@/lib/ui-classes";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

/**
 * A form that opens when a button is pressed has no way to open in a render on the server, so the first useState of the
 * component (its `open` flag, declared first in both forms) is answered with true, for this one render.
 */
function renderOpen(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  state.openFirst = true;
  state.stateCalls = 0;
  try {
    return html(element);
  } finally {
    state.openFirst = false;
  }
}

async function renderPage(page: ReactElement | Promise<ReactElement>): Promise<string> {
  const element = await page;
  return html(createElement(() => element));
}

const SUMMARY = {
  id: "t-1",
  phone: "98765 43210",
  moveIn: "2026-01-15",
  agreementEnd: "2027-03-15",
  advance: 20000,
  advanceStatus: "Held" as const,
  updatedAt: "2026-01-15T05:00:00.000Z",
};

function card(overrides: Partial<PortionCard> = {}): PortionCard {
  return {
    portionId: "p1",
    name: "Ground floor",
    cycleLength: 11,
    status: "pending",
    entry: null,
    next: { tenant: "Asha", count: 4, suggestedAmount: 10000, previousAmount: 10000, startsNewCycle: false },
    rentReference: 10000,
    rentDifference: null,
    undoBlockedReason: null,
    tenancy: null,
    ...overrides,
  };
}

const pending = card({ tenancy: SUMMARY });
const newCycle = card({
  portionId: "p2",
  name: "First floor",
  next: { tenant: "Ravi", count: 1, suggestedAmount: 10503, previousAmount: 10000, startsNewCycle: true },
});
const paid = card({
  portionId: "p3",
  name: "Second floor",
  status: "paid",
  entry: { tenant: "Meena", count: 3, amount: 9000 },
  next: null,
  tenancy: SUMMARY,
});
const paidNoUndo = card({
  portionId: "p4",
  name: "Attic",
  status: "paid",
  entry: { tenant: "Dev", count: 2, amount: 4000 },
  next: null,
  undoBlockedReason: "A later payment has been logged, so this one cannot be undone.",
});
const vacant = card({ portionId: "p5", name: "Shop", status: "needs-tenant", next: null });
const CARDS = [pending, newCycle, paid, paidNoUndo, vacant];

const sheetProps = {
  monthKey: "2026-10",
  monthLabel: "October 2026",
  cards: CARDS,
  defaultDate: "2026-10-05",
  onClose: () => {},
};

const HEADERS = { tenantHeader: "Tenant", countHeader: "Count", amountHeader: "Amount" };

const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  savedAt: "2026-10-05T06:30:00.000Z",
  month: "2026-10",
  portion: "Ground floor",
  tenant: "Asha",
  amount: 10000,
  count: 4,
  dateReceived: "2026-10-05",
  loggedBy: "owner@example.com",
  action: "Logged",
  ...overrides,
});

/** Every screen of the app, as the server renders it, and each open dialog or form. */
const SCREENS: Array<[string, () => Promise<string> | string]> = [
  [
    "PortionBoard",
    () => html(createElement(PortionBoard, { monthKey: "2026-10", monthLabel: "October 2026", cards: CARDS, defaultDate: "2026-10-05" })),
  ],
  ["PaymentSheet, log", () => html(createElement(PaymentSheet, { ...sheetProps, mode: "log", initialPortionId: "p1" }))],
  [
    "PaymentSheet, log on a new cycle",
    () => html(createElement(PaymentSheet, { ...sheetProps, mode: "log", initialPortionId: "p2" })),
  ],
  ["PaymentSheet, edit", () => html(createElement(PaymentSheet, { ...sheetProps, mode: "edit", initialPortionId: "p3" }))],
  [
    "PaymentSheet, new tenant",
    () => html(createElement(PaymentSheet, { ...sheetProps, mode: "new-tenant", initialPortionId: null })),
  ],
  ["UndoSheet", () => html(createElement(UndoSheet, { monthKey: "2026-10", monthLabel: "October 2026", card: paid, onClose: () => {} }))],
  [
    "TenancyForm, add details",
    () =>
      html(
        createElement(TenancyForm, {
          target: { mode: "create", portionId: "p1", tenant: "Asha" },
          initial: emptyTenancyForm("2026-10-05"),
        }),
      ),
  ],
  [
    "TenancyForm, the Edit button",
    () =>
      html(
        createElement(TenancyForm, {
          target: { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "x" },
          initial: emptyTenancyForm("2026-01-15"),
        }),
      ),
  ],
  [
    "TenancyForm, edit form open",
    () =>
      renderOpen(
        createElement(TenancyForm, {
          target: { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "x" },
          initial: emptyTenancyForm("2026-01-15"),
        }),
      ),
  ],
  [
    "MoveOutForm, the Move out button",
    () =>
      html(
        createElement(MoveOutForm, {
          tenant: "Asha",
          portionId: "p1",
          target: { id: "t-1", expectedUpdatedAt: "x", hasAdvance: true, initialNotes: "" },
          initial: emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "" }),
        }),
      ),
  ],
  [
    "MoveOutForm, open",
    () =>
      renderOpen(
        createElement(MoveOutForm, {
          tenant: "Asha",
          portionId: "p1",
          target: { id: "t-1", expectedUpdatedAt: "x", hasAdvance: true, initialNotes: "" },
          initial: emptyMoveOutForm("2026-10-05", { advanceStatus: "Held", notes: "" }),
        }),
      ),
  ],
  [
    "SettingsForm",
    () =>
      html(
        createElement(SettingsForm, {
          portions: [
            { ...HEADERS, id: "p1", name: "Ground floor", cycleLength: 11, hikePercent: 5 },
            { ...HEADERS, id: "p2", name: "Attic", cycleLength: null, hikePercent: 0 },
          ],
        }),
      ),
  ],
  ["LoadProblem", () => html(createElement(LoadProblem, { message: "Google did not answer.", retryHref: "/activity" }))],
  ["More, owner", async () => {
    state.getViewer.mockResolvedValue({ email: "owner@example.com", isOwner: true });
    return renderPage(MorePage({ searchParams: Promise.resolve({}) }) as Promise<ReactElement>);
  }],
  ["More, member", async () => {
    state.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
    return renderPage(MorePage({ searchParams: Promise.resolve({}) }) as Promise<ReactElement>);
  }],
  ["sign-in", async () => {
    state.getViewer.mockResolvedValue(null);
    return renderPage(SignInPage({ searchParams: Promise.resolve({ error: "AccessDenied" }) }) as Promise<ReactElement>);
  }],
  ["TabBar", () => html(createElement(TabBar))],
  ["Activity", async () => {
    state.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
    state.readActivity.mockResolvedValue([item(), item({ action: "Undone", amount: null })]);
    return renderPage(ActivityPage({}) as Promise<ReactElement>);
  }],
  ["Activity, empty", async () => {
    state.getViewer.mockResolvedValue({ email: "member@example.com", isOwner: false });
    state.readActivity.mockResolvedValue([]);
    return renderPage(ActivityPage({}) as Promise<ReactElement>);
  }],
];

beforeEach(() => {
  state.pathname = "/";
  state.getViewer.mockReset();
  state.readActivity.mockReset();
});

describe("the viewport", () => {
  it("fills the screen to the edges, follows the device's light and dark, and colours the browser bar", () => {
    expect(viewport).toEqual({
      width: "device-width",
      initialScale: 1,
      viewportFit: "cover",
      colorScheme: "light dark",
      themeColor: [
        { media: "(prefers-color-scheme: light)", color: BRAND.colors.accent },
        { media: "(prefers-color-scheme: dark)", color: BRAND.colors.backgroundDark },
      ],
      interactiveWidget: "resizes-content",
    });
  });

  it("never stops the person zooming in: no maximum scale, no user-scalable", () => {
    expect(viewport).not.toHaveProperty("maximumScale");
    expect(viewport).not.toHaveProperty("userScalable");
    expect(withoutComments(source("src/app/layout.tsx"))).not.toMatch(/maximumScale|userScalable|user-scalable|maximum-scale/);
  });

  it("keeps the status bar of the installed app at the default style", () => {
    expect(metadata.appleWebApp).toMatchObject({ capable: true, statusBarStyle: "default" });
  });
});

describe("globals.css base styles", () => {
  const css = withoutComments(source("src/app/globals.css"));
  const rule = (selector: string) => {
    const match = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    return (match?.[1] ?? "").replace(/\s+/g, " ").trim();
  };

  it("sets the html background, so the scroll edges and the overscroll show no flash of another colour", () => {
    expect(rule("html")).toContain("background: var(--background)");
  });

  it("stops the phone resizing text, the double-tap zoom delay and the grey tap flash", () => {
    const html = rule("html");
    expect(html).toContain("-webkit-text-size-adjust: 100%");
    expect(html).toContain("touch-action: manipulation");
    expect(html).toContain("-webkit-tap-highlight-color: transparent");
  });

  it("keeps the page from rubber-banding in the installed app only, so a browser tab keeps pull to refresh", () => {
    const standalone = /@media \(display-mode: standalone\)\s*\{\s*html,\s*body\s*\{\s*overscroll-behavior-y:\s*none;?\s*\}\s*\}/.exec(css);
    expect(standalone, "overscroll-behavior-y: none inside (display-mode: standalone)").not.toBeNull();
    // and nowhere else
    expect(css.match(/overscroll-behavior-y/g)).toHaveLength(1);
  });

  it("makes buttons and the tab bar unselectable, with no callout on a long press", () => {
    const match = /(?:^|\n)\s*button,\s*nav\[aria-label="Main"\]\s*\{([^}]*)\}/.exec(css);
    expect(match, "a rule for button and nav[aria-label=Main]").not.toBeNull();
    const body = match![1].replace(/\s+/g, " ");
    expect(body).toContain("user-select: none");
    expect(body).toContain("-webkit-touch-callout: none");
  });

  it("reserves the page's scrollbar gutter, so a sheet's scroll lock does not move the page sideways on a desktop", () => {
    expect(rule("html")).toContain("scrollbar-gutter: stable");
  });

  it("does not make a sheet's scroll lock depend on a scrollbar: the lock rule is still there", () => {
    expect(css).toMatch(/html\.sheet-open,\s*html\.sheet-open body\s*\{\s*overflow:\s*hidden;?\s*\}/);
  });
});

describe("the safe areas", () => {
  const css = withoutComments(source("src/app/globals.css"));

  it("has a top padding that is 1rem, or the notch if that is more", () => {
    expect(css).toMatch(/@utility pt-safe\s*\{\s*padding-top:\s*max\(1rem,\s*env\(safe-area-inset-top\)\);?\s*\}/);
  });

  it("has side padding that is 1rem, or the inset beside the screen's cut-outs if that is more", () => {
    expect(css).toMatch(
      /@utility px-safe\s*\{\s*padding-left:\s*max\(1rem,\s*env\(safe-area-inset-left\)\);\s*padding-right:\s*max\(1rem,\s*env\(safe-area-inset-right\)\);?\s*\}/,
    );
  });

  it("has a sheet height that stops under the notch", () => {
    expect(css).toMatch(/@utility max-h-sheet\s*\{\s*max-height:\s*calc\(100dvh - env\(safe-area-inset-top\)\);?\s*\}/);
  });

  it("puts a page's content clear of the notch and the sides: pt-safe and px-safe in place of pt-4 and px-4", () => {
    for (const classes of [pageClasses(false), pageClasses(false, false), pageClasses(true), pageClasses(true, false)]) {
      const names = classes.split(" ");
      expect(names).toContain("px-safe");
      expect(names).not.toContain("px-4");
      expect(names).not.toContain("pt-4");
    }
    expect(pageClasses(false).split(" ")).toContain("pt-safe");
    expect(pageClasses(false, false).split(" ")).toContain("pt-safe");
  });

  it("gives the bottom sheet a panel that stops under the notch, and still clears the home indicator", () => {
    const sheet = source("src/components/ui/Sheet.tsx");
    expect(sheet).toMatch(/className="[^"]*\bmax-h-sheet\b/);
    expect(sheet).not.toMatch(/\bmax-h-dvh\b/);
    expect(sheet).toMatch(/className="[^"]*\bpb-safe\b/);
  });

  it("puts a toast inside the safe area at the top while a sheet is open, and above the tab bar and home indicator otherwise", () => {
    expect(css).toMatch(/html\.sheet-open \.toast-region\s*\{[^}]*top:\s*calc\(env\(safe-area-inset-top\)/);
    expect(css).toMatch(/@utility bottom-toast\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  });
});

describe("every screen, for a thumb", () => {
  it.each(SCREENS)("%s: every button and link is at least 44 px tall", async (_name, render) => {
    expect(smallTargets(await render())).toEqual([]);
  });

  it.each(SCREENS)("%s: every text field is at least 16 px, so a phone does not zoom in on it", async (_name, render) => {
    expect(smallTextControls(await render())).toEqual([]);
  });

  it.each(SCREENS)("%s: every button and link gives feedback while it is pressed", async (_name, render) => {
    expect(unpressedTargets(await render())).toEqual([]);
  });

  it("really looks at something: each of the screens has buttons or links, or text fields", async () => {
    let controls = 0;
    for (const [, render] of SCREENS) {
      const out = await render();
      controls += (out.match(/<(button|a|input|select|textarea)\b/g) ?? []).length;
    }
    expect(controls).toBeGreaterThan(60);
  });

  it("renders the open forms open: the move-out form has its fields, and the sheets are the real ones", async () => {
    const open = Object.fromEntries(SCREENS.map(([name, render]) => [name, render]));
    const moveOut = await open["MoveOutForm, open"]();
    expect(moveOut).toContain("<form");
    expect(moveOut).toContain("Record move-out");
    expect(moveOut).toContain("What happened to the advance?");
    expect(await open["TenancyForm, edit form open"]()).toContain("Save details");
    const newCycle = await open["PaymentSheet, log on a new cycle"]();
    expect(newCycle).toContain("Round to");
    expect(newCycle).toContain("Keep ₹");
    expect(await open["PaymentSheet, new tenant"]()).toContain("Tenancy details (optional)");
  });
});
