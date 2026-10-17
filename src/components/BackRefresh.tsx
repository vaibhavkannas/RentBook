"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { takeBackRefresh } from "@/lib/back-refresh";

/**
 * Sits in the root layout, which a back does not unmount, and loads a screen again after a tap that went back to it:
 * the browser shows the screen it kept, and someone else may have changed the Sheet since (see src/lib/back-refresh.ts).
 * Offline it leaves the kept screen alone: a refresh would end in the browser's own error page. It renders nothing.
 */
export default function BackRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (takeBackRefresh(pathname, Date.now(), navigator.onLine !== false)) router.refresh();
  }, [pathname, router]);
  return null;
}
