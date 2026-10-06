"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode, type TouchEvent } from "react";
import { addMonths, parseYmKey, ymKey } from "@/lib/domain/year-month";
import { formatMonthTitle } from "@/lib/format";
import { monthHref, shouldStartSwipe, swipeDirection } from "@/lib/month-nav";
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
  const titleRef = useRef<HTMLButtonElement>(null);

  // While a navigation is loading, show the month that was asked for.
  const shownKey = pending ? target : monthKey;
  const shown = parseYmKey(shownKey)!;
  const title = formatMonthTitle(shown);
  const atCurrent = shownKey === currentKey;

  function go(key: string) {
    setPickerOpen(false);
    setTarget(key);
    startTransition(() => {
      router.push(monthHref(key, currentKey));
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
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || dialogIsOpen()) return;
    const touch = event.changedTouches[0];
    const direction = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
    if (direction) go(ymKey(addMonths(shown, direction === "next" ? 1 : -1)));
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* The arrows stay level with the title row; the nav grows only while the Today pill is shown. */}
      <nav aria-label="Month" className="flex items-start justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => go(ymKey(addMonths(shown, -1)))}
          className="grid min-h-11 min-w-11 place-items-center rounded-lg text-xl"
        >
          ‹
        </button>
        <div className="flex flex-col items-center">
          <h1 className="flex text-lg font-semibold">
            <button
              ref={titleRef}
              type="button"
              aria-haspopup="dialog"
              onClick={() => setPickerOpen(true)}
              className="min-h-11 rounded-lg px-3"
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

      {/* Pulse fades between full and half opacity, so no static opacity may sit under it. */}
      <div
        aria-busy={pending}
        inert={pending}
        className={`transition-opacity ${
          pending ? "pointer-events-none motion-safe:animate-pulse motion-reduce:opacity-50" : ""
        }`}
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
