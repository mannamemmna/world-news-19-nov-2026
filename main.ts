// news-image entry — Node 22, standard library only, no network.
//
// The artwork is the `entry.png` that sits next to this file. This program does not
// redraw or re-encode anything: it inspects those bytes, refuses to run if they are
// not a complete, gate-sized PNG, and only then lays the exact same bytes down in
// the output directory. Same input bytes -> same output bytes, every run.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Without MAKEFUN_OUTPUT_DIR the output directory defaults to /output (the grader's
// container path).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE_BYTES = 1024 * 1024; // the gate's 1 MiB ceiling
const MAX_EDGE_PX = 1024;           // the gate's width/height ceiling
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND_CHUNK = Buffer.from([
  0x00, 0x00, 0x00, 0x00, // IEND declares a zero-length payload
  0x49, 0x45, 0x4e, 0x44, // "IEND"
  0xae, 0x42, 0x60, 0x82, // its fixed CRC
]);

function reject(complaint: string): never {
  console.error(`✗ entry.png rejected — ${complaint}`);
  process.exit(1);
}

// Walk the chunk table so a truncated or trailing-garbage file cannot pass as "whole".
function walkChunks(bytes: Buffer): string[] {
  const types: string[] = [];
  let cursor = SIGNATURE.length;
  while (cursor + 8 <= bytes.length) {
    const payload = bytes.readUInt32BE(cursor);
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) reject(`chunk at offset ${cursor} has a bad type tag "${type}"`);
    if (cursor + 8 + payload + 4 > bytes.length) reject(`${type} chunk at offset ${cursor} claims ${payload} bytes but the file ends early`);
    types.push(type);
    cursor += 8 + payload + 4; // length + type + payload + CRC
  }
  if (cursor !== bytes.length) reject(`${bytes.length - cursor} stray byte(s) after the last chunk`);
  if (types.length === 0) reject('no chunks at all');
  return types;
}

const source = new URL('./entry.png', import.meta.url);
const bytes = readFileSync(source);

// --- validation: size, signature, header, completeness -------------------
if (bytes.length > MAX_FILE_BYTES) reject(`${bytes.length} bytes exceeds the ${MAX_FILE_BYTES} byte limit`);
if (!bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE)) reject('first bytes are not the PNG signature 89 50 4E 47 0D 0A 1A 0A');

const chunks = walkChunks(bytes);
if (chunks[0] !== 'IHDR') reject(`file opens with ${chunks[0]}, not IHDR`);
if (chunks[chunks.length - 1] !== 'IEND') reject(`file ends with ${chunks[chunks.length - 1]}, not IEND`);
if (!bytes.subarray(bytes.length - IEND_CHUNK.length).equals(IEND_CHUNK)) reject('closing IEND chunk is malformed');

const width = bytes.readUInt32BE(16);
const height = bytes.readUInt32BE(20);
const bitDepth = bytes[24];
const colorType = bytes[25];
if (width === 0 || height === 0) reject('IHDR reports a zero-width or zero-height image');
if (width > MAX_EDGE_PX || height > MAX_EDGE_PX) reject(`${width}x${height} exceeds the ${MAX_EDGE_PX}x${MAX_EDGE_PX} gate limit`);

console.log(`checked ${source.pathname}`);
console.log(`  signature : PNG ok (89 50 4E 47 0D 0A 1A 0A)`);
console.log(`  size      : ${bytes.length} bytes (limit ${MAX_FILE_BYTES})`);
console.log(`  pixels    : ${width} x ${height} (limit ${MAX_EDGE_PX} x ${MAX_EDGE_PX}), depth ${bitDepth}, colour type ${colorType}`);
console.log(`  chunks    : ${chunks.length}, opening IHDR, closing IEND — file is whole`);

// --- copy: the validated buffer, untouched, into the output directory -----
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const dest = join(outDir, 'entry.png');
mkdirSync(outDir, { recursive: true });
writeFileSync(dest, bytes);

const written = readFileSync(dest);
if (written.length !== bytes.length) reject(`wrote ${written.length} bytes, expected ${bytes.length}`);
for (let i = 0; i < bytes.length; i++) {
  if (written[i] !== bytes[i]) reject(`byte ${i} differs after the copy`);
}
console.log(`wrote ${dest} — ${written.length} bytes, identical to the source`);
