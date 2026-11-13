import type { ReactElement, SVGProps } from "react";

/**
 * The brand mark: a roof over an open book (the rent record), on a 32-unit grid. It has no currency in it, so wave 3 can
 * let the owner pick one. The paths are drawn with a stroke and no fill.
 */
export const BRAND_MARK_PATHS = [
  "M5 13 L16 6 L27 13",
  "M16 17.5 C13 16 9.5 16 7 17 V26 C9.5 25 13 25 16 26.5 C19 25 22.5 25 25 26 V17 C22.5 16 19 16 16 17.5 Z",
  "M16 17.5 V26.5",
] as const;

export const BRAND_MARK_STROKE_WIDTH = 2.4;

type MarkProps = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox" | "stroke">;

/**
 * The mark as an `<svg>` element, drawn the same way by the generated icons (ImageResponse) and by the BrandMark
 * component, so the two cannot drift apart. Plain JSX with no hooks: it runs outside React too.
 *
 * `inset` widens the view box by 4 units on each side, so the 32-unit grid fills 80 % of the width (the mark itself,
 * about 20 of the 40 units across, fills about half) for an icon that runs to the edge of the picture: the mark then
 * stays inside the safe circle a maskable icon is cropped to.
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
