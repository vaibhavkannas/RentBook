"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createToastStore, type ToastAction, type ToastState } from "@/lib/toast";

type ToastApi = { show: (text: string, action?: ToastAction) => void };

const ToastContext = createContext<ToastApi | null>(null);

/**
 * The one place the app shows a toast. It sits in the root layout around the page, so a toast outlives the refresh or
 * replace of the page below it. The live region is always on the page, empty, so a screen reader announces the text that
 * arrives in it. It sits above the tab bar and lets taps through (a sheet's buttons stay reachable), and while a sheet
 * is open it moves to the top of the screen (see `toast-region` in globals.css).
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const [store] = useState(() => createToastStore(setToast));
  useEffect(() => () => store.dispose(), [store]);
  const api = useMemo<ToastApi>(() => ({ show: store.show }), [store]);
  const press = (action: ToastAction) => {
    store.hide();
    action.onPress();
  };

  return (
    <ToastContext value={api}>
      {children}
      <div role="status" className="pointer-events-none fixed inset-x-4 z-50 mx-auto max-w-md bottom-toast toast-region">
        {toast && (
          <div
            key={toast.id}
            className="flex items-center justify-center gap-2 rounded-control bg-foreground px-4 py-3 text-center text-sm text-background"
          >
            <p>{toast.text}</p>
            {/* The region lets taps through; the one thing in it that is pressed takes them back. */}
            {toast.action && (
              <button
                type="button"
                onClick={() => press(toast.action!)}
                className="press pointer-events-auto -my-3 -mr-3 min-h-11 shrink-0 rounded-control px-3 font-semibold underline"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext>
  );
}

const NOBODY: ToastApi = { show: () => {} };

/** `show(text)` puts a toast on the screen. It does nothing outside the provider, so a server render or a test works. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOBODY;
}
