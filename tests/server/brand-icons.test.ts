import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import appleIcon, { generateImageMetadata as appleIconMetadata } from "@/app/apple-icon";
import icon, { generateImageMetadata as iconMetadata } from "@/app/icon";
import manifest from "@/app/manifest";
import { BrandMark } from "@/components/ui/BrandMark";
import { BRAND } from "@/lib/brand";
import { BRAND_MARK_PATHS, BRAND_MARK_STROKE_WIDTH, brandMarkSvg } from "@/lib/brand-mark";
import { packIco } from "../../scripts/make-favicon";
import { decodePng } from "../support/png";

// The brand mark and everything that draws it: the React component, the generated icons, the favicon and the
// manifest that lists them.

const FAVICON = new URL("../../src/app/favicon.ico", import.meta.url);
/** The favicon.ico that create-next-app ships. It must not come back. */
const DEFAULT_FAVICON_SHA256 = "2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("the brand mark", () => {
  it("is a house outline with two ledger lines, on a 32-unit grid", () => {
    expect(BRAND_MARK_PATHS).toEqual([
      "M7 15.5 L16 8 L25 15.5 V24.5 A1.5 1.5 0 0 1 23.5 26 H8.5 A1.5 1.5 0 0 1 7 24.5 Z",
      "M11.5 18.5 H20.5",
      "M11.5 22 H17.5",
    ]);
    expect(BRAND_MARK_STROKE_WIDTH).toBe(2.4);
  });

  it("is drawn as a stroked svg with round caps and joins and no fill", () => {
    const svg = brandMarkSvg({ size: 64, stroke: "#ffffff" });
    expect(isValidElement(svg)).toBe(true);
    expect(svg.type).toBe("svg");
    expect(svg.props).toMatchObject({
      width: 64,
      height: 64,
      viewBox: "0 0 32 32",
      fill: "none",
      stroke: "#ffffff",
      strokeWidth: 2.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    });
    const markup = renderToStaticMarkup(svg);
    for (const d of BRAND_MARK_PATHS) expect(markup).toContain(`d="${d}"`);
  });

  it("widens the view box when it is inset, so the 32-unit grid fills 80 % of a full-bleed icon", () => {
    expect(brandMarkSvg({ size: 64, stroke: "#fff", inset: true }).props.viewBox).toBe("-4 -4 40 40");
    expect(brandMarkSvg({ size: 64, stroke: "#fff", inset: false }).props.viewBox).toBe("0 0 32 32");
  });
});

describe("BrandMark", () => {
  const html = renderToStaticMarkup(createElement(BrandMark, { size: 48 }));

  it("is hidden from screen readers and takes its colour from the text around it", () => {
    expect(html).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(html).toContain('stroke="currentColor"');
  });

  it("is the size asked for, and draws the same paths as the icons", () => {
    expect(html).toContain('width="48"');
    expect(html).toContain('height="48"');
    for (const d of BRAND_MARK_PATHS) expect(html).toContain(`d="${d}"`);
  });

  it("has a default size and takes layout classes", () => {
    const plain = renderToStaticMarkup(createElement(BrandMark));
    expect(plain).toMatch(/width="\d+"/);
    expect(renderToStaticMarkup(createElement(BrandMark, { className: "text-accent" }))).toContain(
      'class="text-accent"',
    );
  });
});

describe("icon.tsx", () => {
  it("makes a 32, a 192 and a 512 pixel PNG", () => {
    expect(iconMetadata()).toEqual([
      { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
      { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
      { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
    ]);
  });
});

describe("apple-icon.tsx", () => {
  it("makes a 180 pixel PNG for iOS and a 512 pixel PNG that doubles as the maskable icon", () => {
    expect(appleIconMetadata()).toEqual([
      { id: "180", size: { width: 180, height: 180 }, contentType: "image/png" },
      { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
    ]);
  });
});

// ---- the pictures themselves ----

async function render(draw: (props: { id: Promise<string> }) => Response | Promise<Response>, id: string) {
  const response = await draw({ id: Promise.resolve(id) });
  return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
}

const ACCENT = [0x1f, 0x5f, 0x4a, 255];
const WHITE = [255, 255, 255, 255];

/** A pixel is the colour asked for, give or take a few steps a channel: another encoder or resvg version may round differently. */
function expectNear(actual: number[], expected: number[], tolerance = 3) {
  expect(
    actual.map((value, i) => Math.abs(value - expected[i]) <= tolerance),
    `pixel ${actual} is not close to ${expected}`,
  ).toEqual(expected.map(() => true));
}

describe("the generated icons", () => {
  it("icon 512 is a 512 by 512 PNG: an accent square with rounded corners, transparent outside, and the white mark", async () => {
    const { response, bytes } = await render(icon, "512");
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = decodePng(bytes);
    expect([png.width, png.height]).toEqual([512, 512]);
    expect(png.rgba(0, 0)[3]).toBeLessThanOrEqual(2);
    expect(png.rgba(511, 511)[3]).toBeLessThanOrEqual(2);
    expectNear(png.rgba(20, 256), ACCENT);
    // the roof's apex (16, 8 on the 32 grid) and the end of the lower ledger line's neighbour
    expectNear(png.rgba(256, 128), WHITE);
    expectNear(png.rgba(256, 296), WHITE);
    expectNear(png.rgba(330, 360), ACCENT);
  });

  it("icon 32 and 192 are PNGs of those sizes", async () => {
    for (const side of [32, 192]) {
      const { response, bytes } = await render(icon, String(side));
      expect(response.headers.get("content-type")).toBe("image/png");
      const png = decodePng(bytes);
      expect([png.width, png.height]).toEqual([side, side]);
      expect(png.rgba(0, 0)[3]).toBeLessThanOrEqual(2);
      expectNear(png.rgba(Math.round(side * 0.04), Math.round(side / 2)), ACCENT);
    }
  });

  it("apple-icon 512 is full bleed, with the mark inside the maskable safe circle", async () => {
    const { response, bytes } = await render(appleIcon, "512");
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = decodePng(bytes);
    expect([png.width, png.height]).toEqual([512, 512]);
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511]]) expectNear(png.rgba(x, y), ACCENT);
    // the roof's apex, with the 4-unit inset: (16 + 4) * 12.8 across, (8 + 4) * 12.8 down
    expectNear(png.rgba(256, 154), WHITE);
    // anything that is not the accent colour lies within 40 % of the width of the centre
    const safeRadius = 0.4 * 512;
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const [r, g, b] = png.rgba(x, y);
        const isBackground = Math.abs(r - ACCENT[0]) < 4 && Math.abs(g - ACCENT[1]) < 4 && Math.abs(b - ACCENT[2]) < 4;
        if (isBackground) continue;
        if (Math.hypot(x - 255.5, y - 255.5) > safeRadius) outside++;
        else inside++;
      }
    }
    expect(inside).toBeGreaterThan(5000); // the mark is there, so the check above is not an empty one
    expect(outside).toBe(0);
  });

  it("apple-icon 180 is a full-bleed PNG too", async () => {
    const { bytes } = await render(appleIcon, "180");
    const png = decodePng(bytes);
    expect([png.width, png.height]).toEqual([180, 180]);
    expectNear(png.rgba(0, 0), ACCENT);
    expectNear(png.rgba(179, 179), ACCENT);
  });
});

describe("the manifest", () => {
  const data = manifest();

  it("names the app and takes its colours from BRAND", () => {
    expect(data.name).toBe(BRAND.name);
    expect(data.short_name).toBe(BRAND.shortName);
    expect(data.description).toBe(BRAND.description);
    expect(data.background_color).toBe(BRAND.colors.background);
    expect(data.theme_color).toBe(BRAND.colors.accent);
  });

  it("has an id, a scope and a language, and opens as an app", () => {
    expect(data).toMatchObject({ id: "/", scope: "/", lang: "en", start_url: "/", display: "standalone" });
  });

  it("lists the generated icons, the last one as the maskable icon", () => {
    expect(data.icons).toEqual([
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
});

// ---- the favicon ----

describe("packIco", () => {
  const fakePng = (size: number, length: number) => {
    const bytes = new Uint8Array(length);
    bytes.set(PNG_SIGNATURE);
    bytes.fill(size, 8);
    return { size, bytes };
  };

  it("writes the header, one entry for each PNG, and then the PNGs", () => {
    const a = fakePng(16, 40);
    const b = fakePng(32, 100);
    const ico = packIco([a, b]);
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(view.getUint16(4, true)).toBe(2);
    // each entry is 16 bytes: width, height, colours, reserved, planes, bits per pixel, size, offset
    expect([view.getUint8(6), view.getUint8(7), view.getUint8(8), view.getUint8(9)]).toEqual([16, 16, 0, 0]);
    expect([view.getUint16(10, true), view.getUint16(12, true)]).toEqual([1, 32]);
    expect(view.getUint32(14, true)).toBe(40);
    expect(view.getUint32(18, true)).toBe(6 + 2 * 16);
    expect([view.getUint8(22), view.getUint8(23)]).toEqual([32, 32]);
    expect(view.getUint32(30, true)).toBe(100);
    expect(view.getUint32(34, true)).toBe(6 + 2 * 16 + 40);
    expect(ico.length).toBe(6 + 2 * 16 + 40 + 100);
    expect([...ico.subarray(38, 38 + 8)]).toEqual(PNG_SIGNATURE);
    expect([...ico.subarray(38 + 40, 38 + 40 + 8)]).toEqual(PNG_SIGNATURE);
  });

  it("writes 256 pixels as 0, as the format asks", () => {
    const ico = packIco([fakePng(256, 20)]);
    expect([ico[6], ico[7]]).toEqual([0, 0]);
  });
});

describe("src/app/favicon.ico", () => {
  const bytes = new Uint8Array(readFileSync(FAVICON));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  it("is no longer the one create-next-app ships", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).not.toBe(DEFAULT_FAVICON_SHA256);
  });

  it("is an icon file whose first image is a PNG", () => {
    expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(view.getUint16(4, true)).toBeGreaterThanOrEqual(1);
    const offset = view.getUint32(18, true);
    expect([...bytes.subarray(offset, offset + 8)]).toEqual(PNG_SIGNATURE);
  });

  it("holds a 32 by 32 icon: transparent outside the rounded corner, the accent colour at the edge, the white mark's roof", () => {
    expect([bytes[6], bytes[7]]).toEqual([32, 32]); // the size the directory entry claims
    const offset = view.getUint32(18, true);
    const length = view.getUint32(14, true);
    const picture = decodePng(bytes.subarray(offset, offset + length));
    expect([picture.width, picture.height]).toEqual([32, 32]);
    expect(picture.rgba(0, 0)[3]).toBeLessThanOrEqual(2);
    expectNear(picture.rgba(1, 16), ACCENT);
    expectNear(picture.rgba(16, 8), WHITE, 6);
  });
});
