"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode, type TouchEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import type { MonthView, PortionCard } from "@/lib/domain/types";
import { addMonths, parseYmKey, ymKey } from "@/lib/domain/year-month";
import { formatMonthTitle } from "@/lib/format";
import { canSwitchHere } from "@/lib/month-window";
import { applyOverlay, beginWrite, liveOverlay, rollbackWrite, savingIds, settleWrite, type Overlay, type Writes } from "@/lib/optimistic";
import { createRefreshStore } from "@/lib/refresh-status";
import { monthFromAddress, monthHref, openMonth, sheetKey, shouldStartSwipe, swipeDirection } from "@/lib/month-nav";
import MonthPicker from "./MonthPicker";
import MonthSummary from "./MonthSummary";
import PaymentSheet, { type SheetMode } from "./PaymentSheet";
import PortionBoard from "./PortionBoard";
import type { RowAction } from "./PortionRow";
import RefreshButton from "./RefreshButton";
import UndoSheet from "./UndoSheet";
import UpdatedLabel from "./UpdatedLabel";

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

/**
 * The sheet that is open, with the month it was opened in (a sheet outlives a switch of month while its request is answered).
 * The nonce makes every opening a new sheet, even for the same portion, so a sheet that was let go cannot come back.
 */
type Active =
  | { nonce: number; mode: SheetMode; portionId: string | null; monthKey: string; monthLabel: string }
  | { nonce: number; mode: "undo"; portionId: string; card: PortionCard; monthKey: string; monthLabel: string };

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
export default function MonthScreen({ monthKey, currentKey, today, renderedAt, views, attention, problem }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(monthKey);
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [refreshStore] = useState(createRefreshStore);
  useEffect(() => () => refreshStore.dispose(), [refreshStore]);
  const opened = useRef(0);
  // Changes on their way to the Sheet: the cards show them at once (see src/lib/optimistic.ts). The data the screen has now is
  // what an answered change waits to be replaced by, and it is kept in a ref so that answering reads the latest.
  const [overlay, setOverlay] = useState<Overlay>({});
  const latestViews = useRef(views);
  useEffect(() => {
    latestViews.current = views;
  });
  const writes = useMemo<Writes>(
    () => ({
      begin: (month, change) => setOverlay((o) => beginWrite(o, month, change, latestViews.current)),
      settle: (month, portionId) => setOverlay((o) => settleWrite(o, month, portionId, latestViews.current)),
      rollback: (month, portionId) => setOverlay((o) => rollbackWrite(o, month, portionId)),
    }),
    [],
  );
  const live = useMemo(() => liveOverlay(overlay, views), [overlay, views]);
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
  const shownView = views[shownKey];
  const view = useMemo(() => (shownView ? applyOverlay(shownView, live, shownKey) : undefined), [shownView, live, shownKey]);
  const saving = useMemo(() => savingIds(live, shownKey), [live, shownKey]);

  /** The cards of a month as they are now, changes on their way included. */
  const cardsOf = (monthKey: string) => (views[monthKey] ? applyOverlay(views[monthKey], live, monthKey).cards : []);
  const openSheet = (action: RowAction | { mode: "new-tenant"; portionId: null }) => {
    opened.current += 1;
    const base = { nonce: opened.current, monthKey: shownKey, monthLabel: title };
    setActive(action.mode === "undo" ? { ...base, mode: "undo", portionId: action.portionId, card: action.card } : { ...base, mode: action.mode, portionId: action.portionId });
  };
  const closeSheet = useCallback(() => setActive(null), []);
  /** Undo, offered on the toast of a payment that was logged: opens the undo sheet for the card as it is now. */
  const undoFromToast = (monthKey: string, portionId: string) => {
    const card = cardsOf(monthKey).find((c) => c.portionId === portionId);
    if (!card || card.status !== "paid" || card.undoBlockedReason !== null) return;
    opened.current += 1;
    setActive({ nonce: opened.current, mode: "undo", portionId, card, monthKey, monthLabel: formatMonthTitle(parseYmKey(monthKey)!) });
  };

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
      {/* One line: the arrows round the title, and on the right the refresh button, or the way back to this month. It wraps rather than overlap on a very narrow screen. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <nav aria-label="Month" className="flex min-w-0 items-center gap-1">
          <IconButton framed label="Previous month" onClick={() => go(ymKey(addMonths(shown, -1)))}>
            <Icon name="left" />
          </IconButton>
          <h1 className="min-w-0 font-display text-lg font-bold leading-tight">
            <button
              ref={titleRef}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPickerOpen(true)}
              className="press flex min-h-11 items-center gap-1 rounded-chip px-1.5"
            >
              {title}
              <Icon name="down" className="size-3.5 shrink-0 text-muted" />
            </button>
          </h1>
          <IconButton framed label="Next month" onClick={() => go(ymKey(addMonths(shown, 1)))}>
            <Icon name="right" />
          </IconButton>
        </nav>
        {atCurrent ? (
          <RefreshButton store={refreshStore} />
        ) : (
          <button
            type="button"
            onClick={() => {
              go(currentKey);
              // The button disappears on the current month, so keep focus somewhere that stays.
              titleRef.current?.focus();
            }}
            className="press min-h-11 whitespace-nowrap rounded-full bg-accent-soft px-3 text-sm font-medium text-accent"
          >
            This month
          </button>
        )}
      </div>

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
            <MonthSummary view={view} status={<UpdatedLabel store={refreshStore} renderedAt={renderedAt} />} />
            {shownKey === currentKey && attention}
            <PortionBoard
              monthKey={shownKey}
              cards={view.cards}
              defaultDate={today}
              saving={saving}
              onAct={openSheet}
              onNewTenant={() => openSheet({ mode: "new-tenant", portionId: null })}
            />
          </div>
        )}
      </div>

      {active &&
        (active.mode === "undo" ? (
          <UndoSheet
            key={`${active.nonce}-${sheetKey(active.monthKey, "undo", active.portionId)}`}
            monthKey={active.monthKey}
            monthLabel={active.monthLabel}
            card={active.card}
            onClose={closeSheet}
            writes={writes}
          />
        ) : (
          <PaymentSheet
            key={`${active.nonce}-${sheetKey(active.monthKey, active.mode, active.portionId)}`}
            mode={active.mode}
            monthKey={active.monthKey}
            monthLabel={active.monthLabel}
            cards={cardsOf(active.monthKey)}
            initialPortionId={active.portionId}
            defaultDate={today}
            onClose={closeSheet}
            writes={writes}
            onUndo={(portionId) => undoFromToast(active.monthKey, portionId)}
          />
        ))}

      {pickerOpen && (
        <MonthPicker shownKey={shownKey} currentKey={currentKey} onPick={go} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
