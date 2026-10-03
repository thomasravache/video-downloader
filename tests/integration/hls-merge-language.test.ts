/**
 * Contrato usado (SPEC-0015 Emenda IMP-01, consome SPEC-0014@1): `assembleMerged` PRESERVA o idioma da trilha de
 * áudio de origem (mdhd) no MP4 junto; sem idioma na origem fica `und`. Fontes reais: e2e/fixtures/hls/course
 * (`audio-en.mp4` = eng, `audio-pt.mp4` = por) e split-av (`audio.mp4`, sem idioma). Passadas como `blob`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleMerged } from '../../entrypoints/offscreen/merge';
import { inspectMp4 } from '../unit/support/mp4';

const COURSE = resolve(import.meta.dirname, '../../e2e/fixtures/hls/course');
const SPLIT = resolve(import.meta.dirname, '../../e2e/fixtures/hls/split-av');
const bytes = (dir: string, name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(dir, name)));
const blobOf = (data: Uint8Array): { blob: Blob } => ({ blob: new Blob([data as BlobPart]) });
const languageOf = (file: Uint8Array, handler: string): string | undefined =>
  inspectMp4(file).tracks.find((t) => t.handler === handler)?.language;

describe('assembleMerged: idioma da trilha de áudio', () => {
  for (const [name, language] of [
    ['audio-en.mp4', 'eng'],
    ['audio-pt.mp4', 'por'],
  ] as const) {
    it(`SPEC-0015:IT-03 ${name}: a fonte é "${language}" e o MP4 junto mantém "${language}" na trilha de áudio`, async () => {
      const audio = bytes(COURSE, name);
      expect(languageOf(audio, 'soun')).toBe(language);

      const out = await assembleMerged(blobOf(bytes(COURSE, 'video-hi.mp4')), blobOf(audio));

      expect(languageOf(out, 'soun')).toBe(language);
      expect(languageOf(out, 'vide')).toBe('und');
    });
  }

  it('SPEC-0015:IT-03 fonte de áudio sem idioma continua "und"', async () => {
    const audio = bytes(SPLIT, 'audio.mp4');
    expect(languageOf(audio, 'soun')).toBe('und');

    const out = await assembleMerged(blobOf(bytes(SPLIT, 'video.mp4')), blobOf(audio));

    expect(languageOf(out, 'soun')).toBe('und');
  });
});
