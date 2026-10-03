/**
 * Montagem de HLS no offscreen (SPEC-0012:UT-05). `mux.js` só pode ser importado daqui (regra de
 * arquitetura mux-js-only-in-offscreen, ADR-0013).
 */
import muxjs from 'mux.js';
import { AssemblyError, MAX_BUFFERED_BYTES } from '../../src/core/hls-download';

function totalBytes(init: Uint8Array | undefined, segments: readonly Uint8Array[]): number {
  return segments.reduce((sum, segment) => sum + segment.byteLength, init?.byteLength ?? 0);
}

/** Recusa antes de tocar nos dados: o total bufferizado passa de 1,5 GiB. */
function assertWithinLimit(init: Uint8Array | undefined, segments: readonly Uint8Array[]): void {
  if (totalBytes(init, segments) > MAX_BUFFERED_BYTES) {
    throw new AssemblyError('TOO_LARGE');
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** Segmentos TS (H.264/AAC) -> MP4. `init` opcional (raramente usado em TS). Rejeita com `AssemblyError`. */
export function assembleTs(
  init: Uint8Array | undefined,
  segments: readonly Uint8Array[],
): Promise<Uint8Array> {
  try {
    assertWithinLimit(init, segments);
    return Promise.resolve(transmux(segments));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new AssemblyError('ASSEMBLY_FAILED'));
  }
}

function transmux(segments: readonly Uint8Array[]): Uint8Array {
  const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
  let initSegment: Uint8Array | undefined;
  const fragments: Uint8Array[] = [];
  transmuxer.on('data', (segment) => {
    if (segment.data.byteLength === 0) {
      return;
    }
    initSegment ??= segment.initSegment;
    fragments.push(segment.data);
  });
  try {
    for (const segment of segments) {
      transmuxer.push(segment);
      transmuxer.flush();
    }
  } catch {
    throw new AssemblyError('UNSUPPORTED_CODEC', 'segmentos não são TS H.264/AAC');
  }
  if (initSegment === undefined || fragments.length === 0) {
    throw new AssemblyError('UNSUPPORTED_CODEC', 'nenhuma trilha H.264/AAC');
  }
  return concat([initSegment, ...fragments]);
}

const CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl'];

function typeAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at + 4] ?? 0,
    bytes[at + 5] ?? 0,
    bytes[at + 6] ?? 0,
    bytes[at + 7] ?? 0,
  );
}

/** Localiza todas as caixas `stsd` descendo só pelos contêineres conhecidos. */
function findStsd(bytes: Uint8Array, start: number, end: number, found: [number, number][]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = start; at + 8 <= end;) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > end) {
      return;
    }
    const type = typeAt(bytes, at);
    if (type === 'stsd') {
      found.push([at, at + size]);
    } else if (CONTAINERS.includes(type)) {
      findStsd(bytes, at + 8, at + size, found);
    }
    at += size;
  }
}

function includesTag(bytes: Uint8Array, from: number, to: number, tag: string): boolean {
  const codes = Array.from(tag, (c) => c.charCodeAt(0));
  for (let at = from; at + 4 <= to; at++) {
    if (codes.every((code, i) => bytes[at + i] === code)) {
      return true;
    }
  }
  return false;
}

/** O init declara amostras criptografadas (`encv`/`enca` ou caixas `sinf`/`schm` na `stsd`)? */
export function initIsEncrypted(init: Uint8Array): boolean {
  const entries: [number, number][] = [];
  findStsd(init, 0, init.byteLength, entries);
  return entries.some(
    ([from, to]) =>
      includesTag(init, from, to, 'sinf') ||
      includesTag(init, from, to, 'schm') ||
      includesTag(init, from, to, 'encv') ||
      includesTag(init, from, to, 'enca'),
  );
}

/** fMP4: `init` + segmentos concatenados (init primeiro). Rejeita com `AssemblyError` (ENCRYPTED se o init tem sinf/schm). */
export function assembleFmp4(
  init: Uint8Array,
  segments: readonly Uint8Array[],
): Promise<Uint8Array> {
  try {
    assertWithinLimit(init, segments);
    if (initIsEncrypted(init)) {
      throw new AssemblyError('ENCRYPTED', 'init com caixa de criptografia');
    }
    return Promise.resolve(concat([init, ...segments]));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new AssemblyError('ASSEMBLY_FAILED'));
  }
}
