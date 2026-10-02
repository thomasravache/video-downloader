/** Constrói MP4s adulterados para os testes de recusa (SPEC-0012). Não é teste. */
import { readBoxes } from './mp4';

const u32 = (n: number): Uint8Array =>
  new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n].map((b) => b & 255));
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const size = 8 + payload.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(size);
  out.set(u32(size), 0);
  out.set(ascii(type), 4);
  let at = 8;
  for (const p of payload) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** `sinf` de criptografia comum (CENC): frma + schm('cenc') + schi vazio. */
export function encryptionSinf(): Uint8Array {
  return box(
    'sinf',
    box('frma', ascii('avc1')),
    box('schm', new Uint8Array([0, 0, 0, 0]), ascii('cenc'), u32(0x00010000)),
    box('schi'),
  );
}

/**
 * Devolve o `init` com um `sinf`/`schm` (criptografia) dentro da entrada de amostra de vídeo
 * (moov/trak/mdia/minf/stbl/stsd/avc1 -> encv), atualizando o tamanho de todas as caixas ancestrais.
 */
export function withEncryptionBox(init: Uint8Array): Uint8Array {
  const path = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'];
  const extra = encryptionSinf();
  const ancestors: { start: number }[] = [];
  let boxes = readBoxes(init);
  for (const type of path) {
    const found = boxes.find((b) => b.type === type);
    if (!found) throw new Error(`init sem ${type}`);
    ancestors.push(found);
    boxes = readBoxes(init, found.payload + (type === 'stsd' ? 8 : 0), found.end);
  }
  const target = boxes.find((b) => b.type === 'avc1');
  if (!target) throw new Error('init sem avc1');
  const out = new Uint8Array(init.byteLength + extra.byteLength);
  out.set(init.subarray(0, target.end), 0);
  out.set(extra, target.end);
  out.set(init.subarray(target.end), target.end + extra.byteLength);
  const dv = new DataView(out.buffer);
  for (const ancestor of [...ancestors, target]) {
    dv.setUint32(ancestor.start, dv.getUint32(ancestor.start) + extra.byteLength);
  }
  // avc1 -> encv (entrada de amostra criptografada).
  out.set(ascii('encv'), target.start + 4);
  return out;
}
