/**
 * Contrato usado (SPEC-0005:UT-03):
 *   src/core/filename.ts -> toFilename({ title?, mediaUrl, mimeType?, now? }): string
 *   Espaços do título são preservados; o fallback é `video-<YYYY-MM-DD>.mp4` (data UTC de `now`).
 */
import { describe, expect, it } from 'vitest';
import { toFilename } from '../../src/core/filename';

const FORBIDDEN = /[/\\:*?"<>|]/;
const now = new Date('2026-09-30T12:00:00Z');
const url = 'https://cdn.example.test/media/clip.mp4';

describe('toFilename', () => {
  it('SPEC-0005:UT-03 remove caracteres proibidos e aplica a extensão pelo mimeType', () => {
    const name = toFilename({
      title: 'Aula 1: Intro/Parte *2*?',
      mediaUrl: url,
      mimeType: 'video/mp4',
      now,
    });

    expect(name).not.toMatch(FORBIDDEN);
    expect(name.startsWith('Aula 1')).toBe(true);
    expect(name.endsWith('.mp4')).toBe(true);
  });

  it('SPEC-0005:UT-03 título de 300 caracteres resulta em no máximo 120, mantendo a extensão', () => {
    const mp4 = toFilename({ title: 'a'.repeat(300), mediaUrl: url, mimeType: 'video/mp4', now });
    const webm = toFilename({ title: 'é'.repeat(300), mediaUrl: url, mimeType: 'video/webm', now });

    expect(mp4.length).toBeLessThanOrEqual(120);
    expect(mp4.endsWith('.mp4')).toBe(true);
    expect(webm.length).toBeLessThanOrEqual(120);
    expect(webm.endsWith('.webm')).toBe(true);
  });

  it('SPEC-0005:UT-03 título preserva espaços e usa a extensão da URL sem mimeType', () => {
    expect(
      toFilename({ title: 'Aula de teste', mediaUrl: 'https://cdn.example.test/v.webm', now }),
    ).toBe('Aula de teste.webm');
    expect(toFilename({ title: 'Aula de teste', mediaUrl: url, mimeType: 'video/mp4', now })).toBe(
      'Aula de teste.mp4',
    );
  });

  it('SPEC-0005:UT-03 sem título usa o último segmento da URL, sem a query', () => {
    expect(
      toFilename({ mediaUrl: 'https://cdn.example.test/path/minha-aula.webm?token=abc', now }),
    ).toBe('minha-aula.webm');
  });

  it('SPEC-0005:UT-03 título vazio ou só com caracteres proibidos e URL sem segmento usa o fallback video-<data>.mp4', () => {
    const noSegment = 'https://cdn.example.test/';
    for (const title of [undefined, '', '   ', '///:::***']) {
      const name = toFilename({ title, mediaUrl: noSegment, now });
      expect(name, `título ${JSON.stringify(title)}`).toMatch(/^video-2026-?09-?30\.mp4$/);
    }
  });
});
