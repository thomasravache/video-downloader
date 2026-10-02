/**
 * Contrato usado (SPEC-0012:UT-03) — src/core/filename.ts:
 *   toFilename({ title, label, mediaUrl }) -> '<título sanitizado> - <rótulo>.mp4', no máximo 120 caracteres.
 *   `label` é o rótulo da variante HLS ('720p', '800 kbps'); a sanitização é a da SPEC-0005
 *   (caracteres proibidos, nomes reservados, espaços); o título é truncado primeiro, o rótulo e a
 *   extensão são preservados. Sem `label` o comportamento da SPEC-0005 não muda (guarda).
 */
import { describe, expect, it } from 'vitest';
import { toFilename } from '../../src/core/filename';

const PLAYLIST = 'https://cdn.test/hls/master.m3u8';

describe('toFilename com rótulo de qualidade (HLS)', () => {
  it('SPEC-0012:UT-03 título + rótulo viram "<título> - <rótulo>.mp4"', () => {
    expect(toFilename({ title: 'Aula 1', label: '720p', mediaUrl: PLAYLIST })).toBe(
      'Aula 1 - 720p.mp4',
    );
  });

  it('SPEC-0012:UT-03 caracteres proibidos no título e no rótulo são sanitizados', () => {
    const name = toFilename({
      title: 'Curso: "Intro" <parte 1>/2?',
      label: '1080p|alta',
      mediaUrl: PLAYLIST,
    });

    expect(name).toMatch(/\.mp4$/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.startsWith('Curso')).toBe(true);
    expect(name).toContain(' - 1080p');
  });

  it('SPEC-0012:UT-03 título longo: no máximo 120 caracteres, preservando " - <rótulo>.mp4"', () => {
    const name = toFilename({ title: 'A'.repeat(300), label: '480p', mediaUrl: PLAYLIST });

    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(' - 480p.mp4')).toBe(true);
    expect(name.startsWith('AAAA')).toBe(true);
  });

  it('SPEC-0012:UT-03 título longo com emoji/acentos não ultrapassa 120 unidades de texto', () => {
    const name = toFilename({ title: 'Ação 🎬 '.repeat(40), label: '360p', mediaUrl: PLAYLIST });

    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(' - 360p.mp4')).toBe(true);
  });

  it('SPEC-0012:UT-03 nome reservado e pontos/espaços nas pontas do título são tratados', () => {
    expect(toFilename({ title: '  ..aula.. ', label: '720p', mediaUrl: PLAYLIST })).toBe(
      'aula - 720p.mp4',
    );
    const reserved = toFilename({ title: 'CON', label: '720p', mediaUrl: PLAYLIST });
    expect(reserved).not.toMatch(/^CON( |\.)/);
    expect(reserved.endsWith(' - 720p.mp4')).toBe(true);
  });

  it('SPEC-0012:UT-03 sem título usa o último trecho da URL da playlist como base e termina em .mp4', () => {
    const name = toFilename({ label: '720p', mediaUrl: PLAYLIST });

    expect(name).toMatch(/ - 720p\.mp4$/);
    expect(name.length).toBeGreaterThan(' - 720p.mp4'.length);
  });

  it('SPEC-0012:UT-03 rótulo em kbps (variante sem altura) também entra no nome', () => {
    expect(toFilename({ title: 'Palestra', label: '800 kbps', mediaUrl: PLAYLIST })).toBe(
      'Palestra - 800 kbps.mp4',
    );
  });

  it('SPEC-0012:UT-03 (guarda: passa antes da mudança) sem label o nome segue a SPEC-0005', () => {
    expect(
      toFilename({
        title: 'Aula de teste',
        mediaUrl: 'https://x.test/a.mp4',
        mimeType: 'video/mp4',
      }),
    ).toBe('Aula de teste.mp4');
  });
});
