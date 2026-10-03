/** Acesso aos arquivos do clipe HLS de fixture (e2e/fixtures/hls/clip, gerado por generate-video.sh). Não é teste. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const CLIP_DIR = resolve(import.meta.dirname, '../../../e2e/fixtures/hls/clip');
/** Duração do clipe em segundos (3 segmentos de ~2 s). */
export const CLIP_DURATION_SEC = 6;

export const clipFile = (relative: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(CLIP_DIR, relative)));
export const clipText = (relative: string): string =>
  readFileSync(resolve(CLIP_DIR, relative), 'utf8');

/** Os 3 segmentos TS de uma qualidade: 'v360' (640x360) ou 'v180' (320x180). */
export const tsSegments = (quality: 'v360' | 'v180'): Uint8Array[] =>
  [0, 1, 2].map((i) => clipFile(`${quality}-${String(i)}.mpegts`));

export const fmp4Init = (): Uint8Array => clipFile('fmp4/init.mp4');
export const fmp4Segments = (): Uint8Array[] =>
  [0, 1, 2].map((i) => clipFile(`fmp4/f-${String(i)}.m4s`));

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}
