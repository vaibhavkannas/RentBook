import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";
import { brandMarkSvg } from "@/lib/brand-mark";

// Full-bleed accent squares: iOS rounds the corners itself, and Android crops the maskable icon to a circle or a
// squircle, so the mark is inset to stay inside the safe zone. The 512 one doubles as the manifest's maskable icon
// (/apple-icon/512), the 180 one is the home-screen icon on iOS.
const SIDES = [180, 512] as const;

export function generateImageMetadata() {
  return SIDES.map((side) => ({
    id: String(side),
    size: { width: side, height: side },
    contentType: "image/png",
  }));
}

export default async function AppleIcon({ id }: { id: Promise<string | number> }) {
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
        }}
      >
        {brandMarkSvg({ size: side, stroke: BRAND.colors.accentInk, inset: true })}
      </div>
    ),
    { width: side, height: side },
  );
}
