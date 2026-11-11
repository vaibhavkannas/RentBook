"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { hrefWithAddressMonth, navAction, previousEntryUrl, type NavigationLike } from "@/lib/app-nav";
import { expectBack } from "@/lib/back-refresh";
import { currentYm, ymKey } from "@/lib/domain/year-month";

/**
 * What a tap on a tab or a back arrow does, for a Link that leads to `href`: it asks navAction (src/lib/app-nav.ts)
 * and carries the answer out. Pass `onNavigate` to the Link. A push is the Link's own; going back and replacing are done
 * here, and the Link's own navigation is cancelled. A back lands on the screen the browser kept, so the screen it lands on
 * is loaded again (BackRefresh, in the root layout). `replacingHref` is the address being replaced to while the next
 * screen loads, for a pending dot.
 */
export function useAppNavigate() {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  /** `fromAddress`: the link was drawn before the address could be read, so its month is read now, at the tap. */
  function onNavigate(rawHref: string, event: { preventDefault: () => void }, options: { fromAddress?: boolean } = {}) {
    const href = options.fromAddress ? hrefWithAddressMonth(rawHref, window.location.search) : rawHref;
    // The Navigation API is not in every browser (nor in the DOM types this project builds with): null then.
    const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
    const action = navAction({
      fromPath: pathname,
      to: href,
      previousUrl: previousEntryUrl(navigation),
      currentKey: ymKey(currentYm(new Date())),
    });
    // A push is what the Link does itself, unless its own address has no month.
    if (action === "push") {
      if (options.fromAddress) {
        event.preventDefault();
        router.push(href);
      }
      return;
    }
    event.preventDefault();
    if (action === "none") {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
    } else if (action === "back") {
      expectBack(href);
      router.back();
    } else {
      setTarget(href);
      startTransition(() => router.replace(href));
    }
  }

  return { onNavigate, replacingHref: loading ? target : null };
}
