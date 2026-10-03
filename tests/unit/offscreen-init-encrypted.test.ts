/**
 * Contrato usado (SPEC-0014, ADR-0014; revisão M1): `initIsEncrypted(init)` (entrypoints/offscreen/assemble.ts)
 * falha FECHADO. Um init com `sinf`/`schm`/`encv`/`enca` é detectado onde quer que esteja (inclusive com `moov` de
 * tamanho de 64 bits, tamanho 1) e um init cujas caixas não podem ser lidas (truncado/inconsistente) conta como
 * criptografado; os inits normais (fixtures split-av, ffmpeg) continuam livres.
 */
import { describe, expect, it } from 'vitest';
import { initIsEncrypted } from '../../entrypoints/offscreen/assemble';
import { splitTrack } from '../integration/support/split-av';
import { box, withEncryptionBox, withEncryptionBoxIn } from './support/mp4-build';
import { readBoxes } from './support/mp4';

const video = splitTrack('video').init;
const audio = splitTrack('audio').init;
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Reescreve a caixa `moov` do init com cabeçalho de 64 bits (size=1 + largesize), sem mudar o conteúdo. */
function withLargeSizeMoov(init: Uint8Array): Uint8Array {
  const moov = readBoxes(init).find((b) => b.type === 'moov');
  if (!moov) throw new Error('init sem moov');
  const payload = init.subarray(moov.start + 8, moov.end);
  const header = new Uint8Array(16);
  const dv = new DataView(header.buffer);
  dv.setUint32(0, 1);
  header.set(ascii('moov'), 4);
  dv.setBigUint64(8, BigInt(16 + payload.byteLength));
  const out = new Uint8Array(moov.start + 16 + payload.byteLength + (init.byteLength - moov.end));
  out.set(init.subarray(0, moov.start), 0);
  out.set(header, moov.start);
  out.set(payload, moov.start + 16);
  out.set(init.subarray(moov.end), moov.start + 16 + payload.byteLength);
  return out;
}

describe('initIsEncrypted: falha fechado (revisão M1)', () => {
  it('SPEC-0014:ADR-0014 inits normais (vídeo e áudio) não são criptografados', () => {
    expect(initIsEncrypted(video)).toBe(false);
    expect(initIsEncrypted(audio)).toBe(false);
  });

  it('SPEC-0014:ADR-0014 moov de 64 bits sem criptografia continua livre', () => {
    expect(initIsEncrypted(withLargeSizeMoov(video))).toBe(false);
    expect(initIsEncrypted(withLargeSizeMoov(audio))).toBe(false);
  });

  it('SPEC-0014:ADR-0014 enca com sinf/schm é detectado', () => {
    expect(initIsEncrypted(withEncryptionBoxIn(audio, 'mp4a', 'enca'))).toBe(true);
    expect(initIsEncrypted(withEncryptionBox(video))).toBe(true);
  });

  it('SPEC-0014:ADR-0014 moov de 64 bits com enca (e sinf) é detectado', () => {
    expect(initIsEncrypted(withLargeSizeMoov(withEncryptionBoxIn(audio, 'mp4a', 'enca')))).toBe(
      true,
    );
    expect(initIsEncrypted(withLargeSizeMoov(withEncryptionBox(video)))).toBe(true);
  });

  it('SPEC-0014:ADR-0014 entrada enca/encv simples (sem sinf) é detectada', () => {
    const plainEnca = Uint8Array.from(audio);
    const at = indexOfTag(plainEnca, 'mp4a');
    expect(at).toBeGreaterThan(0);
    plainEnca.set(ascii('enca'), at);
    expect(initIsEncrypted(plainEnca)).toBe(true);

    const plainEncv = Uint8Array.from(video);
    plainEncv.set(ascii('encv'), indexOfTag(plainEncv, 'avc1'));
    expect(initIsEncrypted(plainEncv)).toBe(true);
  });

  it('SPEC-0014:ADR-0014 marcador de criptografia fora dos contêineres conhecidos (caixa solta) é detectado', () => {
    const extra = box('free', box('sinf'));
    const out = new Uint8Array(video.byteLength + extra.byteLength);
    out.set(video, 0);
    out.set(extra, video.byteLength);
    expect(initIsEncrypted(out)).toBe(true);
  });

  it('SPEC-0014:ADR-0014 init cujas caixas não podem ser lidas conta como criptografado', () => {
    // Truncado no meio da moov (tamanho declarado passa do fim).
    expect(initIsEncrypted(video.subarray(0, video.byteLength - 10))).toBe(true);
    // Tamanho inconsistente (< 8) no cabeçalho da moov.
    const bad = Uint8Array.from(video);
    const moov = readBoxes(bad).find((b) => b.type === 'moov');
    new DataView(bad.buffer).setUint32(moov?.start ?? 0, 4);
    expect(initIsEncrypted(bad)).toBe(true);
    // Lixo e init vazio.
    expect(initIsEncrypted(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(initIsEncrypted(new Uint8Array(0))).toBe(true);
  });
});

function indexOfTag(bytes: Uint8Array, tag: string): number {
  const codes = Array.from(tag, (c) => c.charCodeAt(0));
  for (let at = 0; at + 4 <= bytes.byteLength; at++) {
    if (codes.every((code, i) => bytes[at + i] === code)) return at;
  }
  return -1;
}
