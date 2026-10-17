import type { ReactElement, SVGProps } from "react";

/**
 * The brand mark: a house outline with two ledger lines, on a 32-unit grid. It has no currency in it, so wave 3 can
 * let the owner pick one. The paths are drawn with a stroke and no fill.
 */
export const BRAND_MARK_PATHS = [
  "M7 15.5 L16 8 L25 15.5 V24.5 A1.5 1.5 0 0 1 23.5 26 H8.5 A1.5 1.5 0 0 1 7 24.5 Z",
  "M11.5 18.5 H20.5",
  "M11.5 22 H17.5",
] as const;

export const BRAND_MARK_STROKE_WIDTH = 2.4;

type MarkProps = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox" | "stroke">;

/**
 * The mark as an `<svg>` element, drawn the same way by the generated icons (ImageResponse) and by the BrandMark
 * component, so the two cannot drift apart. Plain JSX with no hooks: it runs outside React too.
 *
 * `inset` widens the view box by 4 units on each side (the mark then fills 80 % of the width) for an icon that
 * runs to the edge of the picture, so the mark stays inside the safe circle a maskable icon is cropped to.
 */
export function brandMarkSvg({
  size,
  stroke,
  inset = false,
  ...rest
}: { size: number; stroke: string; inset?: boolean } & MarkProps): ReactElement<SVGProps<SVGSVGElement>> {
  return (
    <svg
      width={size}
      height={size}
      viewBox={inset ? "-4 -4 40 40" : "0 0 32 32"}
      fill="none"
      stroke={stroke}
      strokeWidth={BRAND_MARK_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {BRAND_MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
