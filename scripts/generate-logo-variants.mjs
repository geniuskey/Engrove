import { deflateSync, inflateSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(workspaceRoot, 'apps/web/public/engrove-mark.png');
const lightPath = resolve(workspaceRoot, 'apps/web/public/engrove-mark-light.png');
const darkPath = resolve(workspaceRoot, 'apps/web/public/engrove-mark-dark.png');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodePng(source) {
  if (!source.subarray(0, signature.length).equals(signature)) throw new Error('Invalid PNG.');
  let offset = signature.length;
  let width = 0;
  let height = 0;
  const compressed = [];
  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error('Logo source must be an 8-bit, non-interlaced RGBA PNG.');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
  }
  const filtered = inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[inputOffset++];
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = filtered[inputOffset++];
      const left = column >= 4 ? pixels[rowOffset + column - 4] : 0;
      const up = row > 0 ? pixels[rowOffset + column - stride] : 0;
      const upperLeft = row > 0 && column >= 4 ? pixels[rowOffset + column - stride - 4] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : filter === 4
                  ? paeth(left, up, upperLeft)
                  : undefined;
      if (predictor === undefined) throw new Error(`Unsupported PNG filter ${filter}.`);
      pixels[rowOffset + column] = (raw + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function encodePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (stride + 1);
    raw[target] = 0;
    pixels.copy(raw, target + 1, row * stride, (row + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const source = await readFile(sourcePath);
const decoded = decodePng(source);
const darkPixels = Buffer.from(decoded.pixels);
const navy = [5, 51, 76];
const cyan = [62, 182, 232];
const darkThemeForeground = [219, 239, 248];

for (let offset = 0; offset < darkPixels.length; offset += 4) {
  if (darkPixels[offset + 3] === 0) continue;
  const navyDistance = Math.hypot(
    darkPixels[offset] - navy[0],
    darkPixels[offset + 1] - navy[1],
    darkPixels[offset + 2] - navy[2],
  );
  const cyanDistance = Math.hypot(
    darkPixels[offset] - cyan[0],
    darkPixels[offset + 1] - cyan[1],
    darkPixels[offset + 2] - cyan[2],
  );
  if (navyDistance >= cyanDistance) continue;
  darkPixels[offset] = darkThemeForeground[0];
  darkPixels[offset + 1] = darkThemeForeground[1];
  darkPixels[offset + 2] = darkThemeForeground[2];
}

await Promise.all([
  writeFile(lightPath, source),
  writeFile(darkPath, encodePng({ ...decoded, pixels: darkPixels })),
]);

console.log('Generated light and dark Engrove logo marks.');
