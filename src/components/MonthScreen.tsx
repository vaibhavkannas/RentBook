"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition, type ReactNode, type TouchEvent } from "react";
import { IconButton } from "@/components/ui/IconButton";
import type { MonthView } from "@/lib/domain/types";
import { addMonths, parseYmKey, ymKey } from "@/lib/domain/year-month";
import { formatMonthTitle } from "@/lib/format";
import { canSwitchHere } from "@/lib/month-window";
import { monthFromAddress, monthHref, openMonth, shouldStartSwipe, swipeDirection } from "@/lib/month-nav";
import MonthPicker from "./MonthPicker";
import MonthSummary from "./MonthSummary";
import PortionBoard from "./PortionBoard";

/** Sent on the window when the month screen has replaced the address itself. */
const ADDRESS_CHANGED = "rentbook:address-changed";

function subscribeToAddress(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(ADDRESS_CHANGED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(ADDRESS_CHANGED, onChange);
  };
}

type Props = {
  /** The month the server rendered. */
  monthKey: string;
  /** The current calendar month (India time), for the Today pill. */
  currentKey: string;
  /** Today, as the payment sheet's default date. */
  today: string;
  /** When the server read the Sheet, in ms since the epoch. */
  renderedAt: number;
  /** The view of every month the page carries, by month key. Empty when the Sheet could not be read. */
  views: Record<string, MonthView>;
  /** The Needs attention card, drawn on the server. It belongs to the current month, so it shows only there. */
  attention: ReactNode;
  /** What to say instead of the figures when the Sheet could not be read. */
  problem: ReactNode;
};

/**
 * The month screen: the header with its arrows, and the month that is showing. The page carries the views of the months
 * around this one (see src/lib/month-window.ts), so an arrow, a swipe or the month picker switches month on the spot, with no
 * request, and keeps `?month=` in the address with the browser's own history call (the router follows it, so the tab bar
 * and a reload see the month). The address is replaced, never added to, so Back does not walk through the months. A month the
 * page does not carry is opened with a navigation to the server, as before, and the screen shows the month asked for while
 * it loads.
 */
export default function MonthScreen({ monthKey, currentKey, today, views, attention, problem }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(monthKey);
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  const titleRef = useRef<HTMLButtonElement>(null);

  // The address is the truth about the month on show, so this reads it: a switch writes the address, and a navigation, a
  // refresh, a kept screen shown again by Back, and the history moving all show up in it. A refresh that was asked for before
  // a switch brings the old month with it, and must not pull the screen back: the address wins. On the server (and while the
  // page hydrates) the month is the one the page was rendered for.
  const address = useSyncExternalStore(subscribeToAddress, () => window.location.search, () => `?month=${monthKey}`);
  const named = monthFromAddress(address, currentKey);
  const selected = canSwitchHere(views, named) ? named : monthKey;

  // While a navigation to the server is loading, show the month that was asked for.
  const shownKey = pending ? target : selected;
  const shown = parseYmKey(shownKey)!;
  const title = formatMonthTitle(shown);
  const atCurrent = shownKey === currentKey;
  const view = views[shownKey];

  function go(key: string) {
    setPickerOpen(false);
    if (key === shownKey) return;
    if (canSwitchHere(views, key)) {
      setDirection(key > shownKey ? "next" : "prev");
      window.history.replaceState(null, "", monthHref(key, currentKey));
      // The browser tells no one about a replaced address, so the screen is told.
      window.dispatchEvent(new Event(ADDRESS_CHANGED));
      return;
    }
    setTarget(key);
    startTransition(() => {
      openMonth(router, key, currentKey);
    });
  }

  // Any open dialog (the payment sheet or the month picker) blocks swiping, including a drag that
  // starts on its dimmed backdrop, which sits outside the dialog panel.
  function dialogIsOpen() {
    return pickerOpen || document.querySelector('[role="dialog"]') !== null;
  }

  function onTouchStart(event: TouchEvent) {
    if (!shouldStartSwipe(event.touches.length, dialogIsOpen())) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    // A row that scrolls sideways (the filter chips) keeps its own drags.
    const ignore = event.target instanceof Element && event.target.closest("[data-no-swipe]") !== null;
    touchStart.current = { x: touch.clientX, y: touch.clientY, ignore };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || start.ignore || dialogIsOpen()) return;
    const touch = event.changedTouches[0];
    const swipe = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
    if (swipe) go(ymKey(addMonths(shown, swipe === "next" ? 1 : -1)));
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* The arrows stay level with the title row; the nav grows only while the Today pill is shown. */}
      <nav aria-label="Month" className="flex items-start justify-between">
        <IconButton label="Previous month" onClick={() => go(ymKey(addMonths(shown, -1)))}>
          ‹
        </IconButton>
        <div className="flex flex-col items-center">
          <h1 className="flex text-lg font-semibold">
            <button
              ref={titleRef}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPickerOpen(true)}
              className="press min-h-11 rounded-chip px-3"
            >
              {title} <span aria-hidden="true">▾</span>
            </button>
          </h1>
          {!atCurrent && (
            <button
              type="button"
              onClick={() => {
                go(currentKey);
                // The pill disappears on the current month, so keep focus somewhere that stays.
                titleRef.current?.focus();
              }}
              className="press -mt-1 min-h-11 rounded-full px-3 text-sm font-medium text-accent underline"
            >
              Today
            </button>
          )}
        </div>
        <IconButton label="Next month" onClick={() => go(ymKey(addMonths(shown, 1)))}>
          ›
        </IconButton>
      </nav>

      <p role="status" className="sr-only">
        {pending ? `Loading ${title}` : ""}
      </p>

      {/* Pulse fades between full and half opacity, so no static opacity may sit under it. */}
      <div
        aria-busy={pending}
        inert={pending}
        className={`transition-opacity ${
          pending ? "pointer-events-none motion-safe:animate-pulse motion-reduce:opacity-50" : ""
        }`}
      >
        {problem}
        {view && (
          <div key={shownKey} data-direction={direction ?? undefined} className="month-in">
            <MonthSummary view={view} />
            {shownKey === currentKey && attention}
            <PortionBoard monthKey={shownKey} monthLabel={title} cards={view.cards} defaultDate={today} />
          </div>
        )}
      </div>

      {pickerOpen && (
        <MonthPicker shownKey={shownKey} currentKey={currentKey} onPick={go} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
