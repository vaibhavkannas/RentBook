import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png";

// decodePng is what the icon tests read the generated pictures with, so it is checked against pictures built here.

type Spec = { width: number; height: number; colorType: number; depth: number; interlace?: number; palette?: number[]; trns?: number[] };

const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data).copy(out, 8);
  return out; // the checksum is left empty: the reader does not check it
};

/** `rows`: the unfiltered bytes of each row. `filter` is applied to every row before the picture is compressed. */
function png(spec: Spec, rows: number[][], filter = 0, bytesPerPixel = 1): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(spec.width, 0);
  header.writeUInt32BE(spec.height, 4);
  header.set([spec.depth, spec.colorType, 0, 0, spec.interlace ?? 0], 8);
  const filtered = rows.flatMap((row, y) => {
    const prev = y > 0 ? rows[y - 1] : row.map(() => 0);
    const out = row.map((value, i) => {
      const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
      const up = y > 0 ? prev[i] : 0;
      const upLeft = y > 0 && i >= bytesPerPixel ? prev[i - bytesPerPixel] : 0;
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      return (value - [0, left, up, (left + up) >> 1, paeth][filter] + 256) & 255;
    });
    return [filter, ...out];
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(spec.palette ? [chunk("PLTE", Buffer.from(spec.palette))] : []),
    ...(spec.trns ? [chunk("tRNS", Buffer.from(spec.trns))] : []),
    chunk("IDAT", deflateSync(Buffer.from(filtered))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("decodePng", () => {
  it("reads 8-bit RGBA", () => {
    const picture = decodePng(png({ width: 2, height: 1, colorType: 6, depth: 8 }, [[10, 20, 30, 40, 250, 240, 230, 220]]));
    expect([picture.width, picture.height]).toEqual([2, 1]);
    expect(picture.rgba(0, 0)).toEqual([10, 20, 30, 40]);
    expect(picture.rgba(1, 0)).toEqual([250, 240, 230, 220]);
  });

  it("reads 8-bit RGB as opaque, and 16-bit RGBA by its high bytes", () => {
    expect(decodePng(png({ width: 1, height: 1, colorType: 2, depth: 8 }, [[1, 2, 3]])).rgba(0, 0)).toEqual([1, 2, 3, 255]);
    const wide = decodePng(png({ width: 1, height: 1, colorType: 6, depth: 16 }, [[0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0xff, 0xff]]));
    expect(wide.rgba(0, 0)).toEqual([255, 128, 0, 255]);
  });

  it("reads grey and grey with alpha", () => {
    expect(decodePng(png({ width: 2, height: 1, colorType: 0, depth: 8 }, [[0, 200]])).rgba(1, 0)).toEqual([200, 200, 200, 255]);
    expect(decodePng(png({ width: 1, height: 1, colorType: 4, depth: 8 }, [[90, 45]])).rgba(0, 0)).toEqual([90, 90, 90, 45]);
    // 1 bit: eight pixels in a byte, 10100000 is white, black, white, black, ...
    const bits = decodePng(png({ width: 4, height: 1, colorType: 0, depth: 1 }, [[0b10100000]]));
    expect([0, 1, 2, 3].map((x) => bits.rgba(x, 0)[0])).toEqual([255, 0, 255, 0]);
  });

  it("reads a palette picture, with its transparency, at 8 bits and at 2 bits", () => {
    const palette = [255, 0, 0, 0, 255, 0, 0, 0, 255];
    const eight = decodePng(png({ width: 3, height: 1, colorType: 3, depth: 8, palette, trns: [0, 128] }, [[0, 1, 2]]));
    expect([0, 1, 2].map((x) => eight.rgba(x, 0))).toEqual([
      [255, 0, 0, 0],
      [0, 255, 0, 128],
      [0, 0, 255, 255],
    ]);
    // 2 bits: the indexes 2, 1, 0, 1 packed as 10 01 00 01
    const two = decodePng(png({ width: 4, height: 1, colorType: 3, depth: 2, palette }, [[0b10010001]]));
    expect([0, 1, 2, 3].map((x) => two.rgba(x, 0).slice(0, 3))).toEqual([[0, 0, 255], [0, 255, 0], [255, 0, 0], [0, 255, 0]]);
  });

  it.each([1, 2, 3, 4])("undoes row filter %i", (filter) => {
    const rows = [
      [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255],
      [15, 25, 35, 255, 45, 55, 65, 200, 75, 85, 95, 100],
      [250, 5, 128, 0, 1, 2, 3, 4, 200, 100, 50, 25],
    ];
    const picture = decodePng(png({ width: 3, height: 3, colorType: 6, depth: 8 }, rows, filter, 4));
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) expect(picture.rgba(x, y)).toEqual(rows[y].slice(4 * x, 4 * x + 4));
    }
  });

  it("refuses what it cannot read, saying why", () => {
    expect(() => decodePng(Buffer.from("not a picture at all, really"))).toThrow(/signature/);
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 6, depth: 8, interlace: 1 }, [[0, 0, 0, 0]]))).toThrow(/interlaced/);
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 2, depth: 4 }, [[0]]))).toThrow(/Unsupported/);
  });
});
