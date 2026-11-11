import type { ReactNode } from "react";

/**
 * The small icons of the app, drawn inline (no icon package): 24 by 24, a 1.8 stroke in the colour of the text round
 * them. They only decorate (aria-hidden): whatever they sit in says the same in words.
 */
const PATHS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  dash: <path d="M6 12h12" />,
  rotate: <path d="M19 8a7.5 7.5 0 10.8 5M19 4v4h-4" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  warn: <path d="M12 4l9 15.5H3L12 4zM12 10v4M12 17v.3" />,
  month: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  list: <path d="M5 6h14M5 12h14M5 18h9" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  bang: <path d="M12 6v7M12 17.5v.5" />,
  user: (
    <>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" />
    </>
  ),
  out: <path d="M10 5H6v14h4M14 8l4 4-4 4M18 12H9" />,
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  bell: <path d="M6 17h12l-1.5-2.5V11a4.5 4.5 0 00-9 0v3.5L6 17zM10 20h4" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-5 shrink-0"}
    >
      {PATHS[name]}
    </svg>
  );
}
