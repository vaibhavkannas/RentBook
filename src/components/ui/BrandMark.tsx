import { brandMarkSvg } from "@/lib/brand-mark";

type Props = { size?: number; className?: string };

/** The brand mark in the colour of the text around it, for the sign-in page and the More screen. */
export default function BrandMark({ size = 32, className }: Props) {
  return brandMarkSvg({ size, stroke: "currentColor", className, "aria-hidden": true });
}
