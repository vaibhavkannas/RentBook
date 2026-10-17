import { inflateSync } from "node:zlib";

/**
 * A small PNG reader for tests that look at the pictures the app draws (the icons). It reads whatever a sane encoder
 * writes, not one particular encoder's choice: grey, grey with alpha, RGB, RGBA and palette pictures (with a tRNS
 * chunk), at any bit depth the format allows for them, with any of the five row filters. Not interlaced pictures.
 * Every pixel is given back as 8-bit RGBA.
 */
export type Png = {
  width: number;
  height: number;
  rgba: (x: number, y: number) => [number, number, number, number];
};

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SAMPLES_PER_PIXEL: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ALLOWED_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

export function decodePng(bytes: Uint8Array): Png {
  const buffer = Buffer.from(bytes);
  if (!SIGNATURE.every((byte, i) => buffer[i] === byte)) throw new Error("Not a PNG: the signature is wrong.");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colorType = buffer[25];
  if (buffer[28] !== 0) throw new Error("This helper does not read interlaced PNGs.");
  if (!ALLOWED_DEPTHS[colorType]?.includes(depth)) throw new Error(`Unsupported PNG: colour type ${colorType}, depth ${depth}.`);

  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    offset += 12 + length;
  }

  const bitsPerPixel = SAMPLES_PER_PIXEL[colorType] * depth;
  const step = Math.max(1, bitsPerPixel >> 3); // bytes from one pixel to the one before it, for the filters
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const left = i >= step ? rows[y * stride + i - step] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= step ? rows[(y - 1) * stride + i - step] : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      };
      if (filter > 4) throw new Error(`Unsupported PNG row filter ${filter}.`);
      const predictor = [0, left, up, (left + up) >> 1, paeth()][filter];
      rows[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + predictor) & 255;
    }
  }

  /** Sample number `n` of row `y` as a whole number of its own depth. */
  const sample = (y: number, n: number): number => {
    const row = y * stride;
    if (depth === 8) return rows[row + n];
    if (depth === 16) return (rows[row + 2 * n] << 8) | rows[row + 2 * n + 1];
    const bit = n * depth;
    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const to8 = (value: number) => Math.round((value * 255) / (2 ** depth - 1));
  const per = SAMPLES_PER_PIXEL[colorType];

  return {
    width,
    height,
    rgba: (x, y) => {
      const n = x * per;
      switch (colorType) {
        case 0: {
          const g = to8(sample(y, n));
          return [g, g, g, 255];
        }
        case 2:
          return [to8(sample(y, n)), to8(sample(y, n + 1)), to8(sample(y, n + 2)), 255];
        case 3: {
          const index = sample(y, n);
          if (!palette) throw new Error("A palette picture with no PLTE chunk.");
          return [palette[3 * index], palette[3 * index + 1], palette[3 * index + 2], transparency?.[index] ?? 255];
        }
        case 4: {
          const g = to8(sample(y, n));
          return [g, g, g, to8(sample(y, n + 1))];
        }
        default:
          return [to8(sample(y, n)), to8(sample(y, n + 1)), to8(sample(y, n + 2)), to8(sample(y, n + 3))];
      }
    },
  };
}
