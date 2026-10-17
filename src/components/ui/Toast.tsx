"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createToastStore, type ToastState } from "@/lib/toast";

type ToastApi = { show: (text: string) => void };

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

  return (
    <ToastContext value={api}>
      {children}
      <div role="status" className="pointer-events-none fixed inset-x-4 z-50 mx-auto max-w-md bottom-toast toast-region">
        {toast && (
          <p key={toast.id} className="rounded-control bg-foreground px-4 py-3 text-center text-sm text-background">
            {toast.text}
          </p>
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
