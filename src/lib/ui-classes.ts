/**
 * The class strings the shared pieces in src/components/ui are drawn with. They are the ones the screens use today,
 * so putting a screen on a primitive moves nothing. They are written out in full (not built from a tone name) so
 * that Tailwind finds each class in the source. Pure on purpose, so a test can read them.
 */

export type ButtonVariant = "primary" | "secondary" | "danger" | "dangerText" | "quiet";
export type ButtonSize = "lg" | "md";
export type Tone = "success" | "warn" | "danger";
export type PillTone = Tone | "neutral";

/** Joins class names, skipping anything empty. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const BUTTON_BASE =
  "press inline-flex items-center justify-center gap-2 rounded-xl px-4 font-medium disabled:opacity-60";

/** 48 px for the button that finishes a form, 44 px (the least a thumb should be asked to hit) for the rest. */
const BUTTON_SIZE: Record<ButtonSize, string> = {
  lg: "min-h-12",
  md: "min-h-11",
};

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink",
  secondary: "border border-control",
  danger: "bg-danger-bg text-danger-ink",
  dangerText: "text-danger-ink underline",
  quiet: "text-muted",
};

export const buttonClasses = (variant: ButtonVariant, size: ButtonSize) =>
  `${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]}`;

/** A text field, a select and a date field. 16 px text, so a phone does not zoom in when it takes focus. */
export const FIELD_CONTROL =
  "mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base";

/** The amount field: the same, with larger text. */
const LARGE_CONTROL = "mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-lg";

/** A text area grows with its rows, so it has vertical padding and no minimum height. */
const TEXTAREA_CONTROL = "mt-1 w-full rounded-xl border border-control bg-surface px-3 py-2 text-base";

export const fieldControlClasses = (kind: "input" | "textarea" = "input", large = false) =>
  `${kind === "textarea" ? TEXTAREA_CONTROL : large ? LARGE_CONTROL : FIELD_CONTROL} disabled:opacity-50`;

const NOTICE_TONE: Record<Tone, string> = {
  success: "bg-success-bg text-success-ink",
  warn: "bg-warn-bg text-warn-ink",
  danger: "bg-danger-bg text-danger-ink",
};

export const noticeClasses = (tone: Tone) => `rounded-lg px-3 py-2 text-sm ${NOTICE_TONE[tone]}`;

const PILL_TONE: Record<PillTone, string> = {
  success: "bg-success-bg text-success-ink",
  warn: "bg-warn-bg text-warn-ink",
  danger: "bg-danger-bg text-danger-ink",
  neutral: "bg-line text-foreground",
};

export const pillClasses = (tone: PillTone) =>
  `shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium ${PILL_TONE[tone]}`;

export const CARD = "rounded-2xl border border-line bg-surface p-4";

/** A grey placeholder bar. It pulses, except for people who asked their device for less motion. */
export const SKELETON_BAR = "rounded-lg bg-line animate-pulse motion-reduce:animate-none";

/** The single phone column, with a 16 px gutter. `center` is for the sign-in and error pages. */
export const pageClasses = (center: boolean) =>
  cx("mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4", center && "flex flex-col justify-center");
