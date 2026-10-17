import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { brandMarkSvg } from "@/lib/brand-mark";

// The browser-tab and "any" icons: an accent rounded square, transparent outside its corners, with the brand mark.
// Next serves them as /icon/32, /icon/192 and /icon/512 (the manifest lists the last two).
const SIDES = [32, 192, 512] as const;

export function generateImageMetadata() {
  return SIDES.map((side) => ({
    id: String(side),
    size: { width: side, height: side },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const side = Number(await id);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.colors.accent,
          borderRadius: Math.round(side * 0.22),
        }}
      >
        {brandMarkSvg({ size: side, stroke: BRAND.colors.accentInk })}
      </div>
    ),
    { width: side, height: side },
  );
}
