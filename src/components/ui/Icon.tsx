import type { ReactNode } from "react";

/**
 * The small icons of the month screen, drawn inline (no icon package): 24 by 24, a 1.8 stroke in the colour of the text round
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
