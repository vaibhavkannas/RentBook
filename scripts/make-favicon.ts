/**
 * Regenerates src/app/favicon.ico from the generated icon (src/app/icon.tsx). Run it after changing the brand mark
 * or the accent colour, from the repository root, and commit the file:
 *
 *   npx tsx scripts/make-favicon.ts
 *
 * It is not an npm script: it is needed once in a long while. The favicon is an ICO file that holds one image, the
 * 32 pixel PNG of the icon (every modern browser reads PNG inside ICO). A test (tests/server/brand-icons.test.ts)
 * decodes the committed picture and fails when it is not 32 by 32, has no transparent corner, lacks the accent colour
 * at its edge or the white roof apex of the mark: it checks the picture, not the exact bytes, so a different PNG
 * encoder gives the same result.
 *
 * `next/og`, which draws the icon, runs outside Next, so the PNG comes from calling the icon's own function.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import icon from "../src/app/icon";

/**
 * Packs PNG pictures into one ICO file: the six-byte header, one 16-byte entry for each picture, then the pictures.
 * `size` is the side of the square picture in pixels.
 */
export function packIco(pngs: { size: number; bytes: Uint8Array }[]): Uint8Array {
  const headerLength = 6 + 16 * pngs.length;
  const out = new Uint8Array(headerLength + pngs.reduce((sum, png) => sum + png.bytes.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon (2 would be a cursor)
  view.setUint16(4, pngs.length, true);
  let offset = headerLength;
  pngs.forEach(({ size, bytes }, index) => {
    const entry = 6 + 16 * index;
    const side = size >= 256 ? 0 : size; // the format writes 256 as 0
    view.setUint8(entry, side); // width
    view.setUint8(entry + 1, side); // height
    view.setUint8(entry + 2, 0); // colours in the palette: none
    view.setUint8(entry + 3, 0); // reserved
    view.setUint16(entry + 4, 1, true); // colour planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, bytes.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(bytes, offset);
    offset += bytes.length;
  });
  return out;
}

async function main() {
  const response = await icon({ id: Promise.resolve("32") });
  const png = new Uint8Array(await response.arrayBuffer());
  const target = path.resolve(__dirname, "..", "src", "app", "favicon.ico");
  writeFileSync(target, packIco([{ size: 32, bytes: png }]));
  console.log(`Wrote ${target} (${png.length} bytes of PNG).`);
}

// Only when it is run as a script, not when a test imports packIco.
if (path.basename(process.argv[1] ?? "").startsWith("make-favicon")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
