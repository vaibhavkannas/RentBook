"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { tabbable } from "@/lib/focusable";
import { shouldCloseOnBackdrop, trapTabIndex } from "@/lib/month-nav";

type Props = {
  /** The id of the element inside that names the dialog. */
  labelledBy: string;
  /** The id of the element inside that says what the dialog is about, if there is one. */
  describedBy?: string;
  onClose: () => void;
  /** False while something is being saved: Escape and the backdrop then do nothing. */
  canClose: boolean;
  /**
   * Whether a tap on the dimmed page closes the sheet. A sheet with a form says false, so a stray tap never loses what
   * was typed; the month picker, which holds nothing, says true.
   */
  closeOnBackdrop: boolean;
  /** What takes focus when the sheet opens. Without it, an autofocus control inside, else the sheet itself. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/**
 * The bottom sheet every dialog in the app is built on: a backdrop, a panel at the bottom of the screen with a grab
 * bar, and the behaviour a dialog needs. Escape closes it (while `canClose`); Tab stays inside it; focus goes in when
 * it opens and back to what opened it when it closes; and the page behind it does not scroll.
 */
export function Sheet({ labelledBy, describedBy, onClose, canClose, closeOnBackdrop, initialFocus, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Where the latest press began and ended, so a drag from the panel onto the backdrop is not a tap on it.
  const press = useRef({ downOnBackdrop: false, upOnBackdrop: false });
  // What had focus before the sheet opened. It is taken while the sheet renders, because a control with `autoFocus`
  // takes focus when the sheet is put on the page: an effect would find that control and hand focus back to it.
  const [opener] = useState(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  // Move focus in on open: to the element asked for, else leave a control that took focus itself, else the sheet.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (initialFocus?.current) initialFocus.current.focus();
    else if (!panel.contains(document.activeElement)) panel.focus();
    // Only on open: a later change of `initialFocus` must not pull focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Give focus back to what opened the sheet, if it is still on the page. Only when the sheet has really gone: React's
  // development build runs every effect twice, and that first clean-up must not take focus from an autofocus control.
  useEffect(() => {
    const panel = panelRef.current;
    return () => {
      if (panel && !panel.isConnected && opener?.isConnected) opener.focus();
    };
  }, [opener]);

  // The page behind does not scroll while a sheet is open (see globals.css).
  useEffect(() => {
    document.documentElement.classList.add("sheet-open");
    return () => document.documentElement.classList.remove("sheet-open");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (canClose) onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = tabbable(panel);
      if (items.length === 0) {
        // Nothing to move to (everything is disabled while a save runs): stay where focus is rather than leave.
        event.preventDefault();
        panel.focus();
        return;
      }
      const next = trapTabIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (next !== null) {
        event.preventDefault();
        items[next].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  const backdropHandlers = closeOnBackdrop
    ? {
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
          press.current = { downOnBackdrop: event.target === event.currentTarget, upOnBackdrop: false };
        },
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
          press.current.upOnBackdrop = event.target === event.currentTarget;
        },
        onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
          const { downOnBackdrop, upOnBackdrop } = press.current;
          press.current = { downOnBackdrop: false, upOnBackdrop: false };
          const clickOnBackdrop = event.target === event.currentTarget;
          if (canClose && shouldCloseOnBackdrop({ downOnBackdrop, upOnBackdrop, clickOnBackdrop })) onClose();
        },
      }
    : {};

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-overlay" {...backdropHandlers}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="max-h-dvh w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-5 pb-safe focus:outline-none"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />
        {children}
      </div>
    </div>
  );
}
