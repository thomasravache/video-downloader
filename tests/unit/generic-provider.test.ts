/**
 * Contrato usado (SPEC-0005:UT-02):
 *   src/core/contracts      -> PageSnapshot { pageUrl, pageTitle, videos: VideoSnapshot[] },
 *                              VideoSnapshot { src, currentSrc, sources[], hasMediaKeys, encrypted }
 *   src/providers/generic   -> extractCandidates(snapshot, tabId): VideoCandidate[]
 *                              (providerId 'generic'; title = pageTitle; mimeType pela extensão da URL)
 */
import { describe, expect, it } from 'vitest';
import type { PageSnapshot } from '../../src/core/contracts';
import { extractCandidates } from '../../src/providers/generic';

const A = 'https://cdn.example.test/a.mp4';
const B = 'https://cdn.example.test/b.webm';

function page(video: Partial<PageSnapshot['videos'][number]>): PageSnapshot {
  return {
    pageUrl: 'https://site.example.test/aula',
    pageTitle: 'Aula 1',
    videos: [
      { src: null, currentSrc: '', sources: [], hasMediaKeys: false, encrypted: false, ...video },
    ],
  };
}

describe('provider generic: extractCandidates', () => {
  it('SPEC-0005:UT-02 currentSrc igual a um dos dois <source> gera 2 candidatos com URLs distintas', () => {
    const candidates = extractCandidates(page({ currentSrc: A, sources: [A, B] }), 7);

    expect(candidates.map((c) => c.mediaUrl).sort()).toEqual([A, B]);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(2);
    for (const c of candidates) {
      expect(c).toMatchObject({
        providerId: 'generic',
        tabId: 7,
        pageUrl: 'https://site.example.test/aula',
        title: 'Aula 1',
        protection: 'none',
        support: 'downloadable',
      });
    }
    expect(candidates.find((c) => c.mediaUrl === B)?.mimeType).toBe('video/webm');
  });

  it('SPEC-0005:UT-02 os IDs são estáveis entre execuções e mudam com a aba', () => {
    const snapshot = page({ currentSrc: A, sources: [A, B] });

    const first = extractCandidates(snapshot, 7).map((c) => c.id);
    const second = extractCandidates(snapshot, 7).map((c) => c.id);
    const otherTab = extractCandidates(snapshot, 8).map((c) => c.id);

    expect(second).toEqual(first);
    expect(otherTab).not.toEqual(first);
  });

  it('SPEC-0005:UT-02 src igual a currentSrc não duplica o candidato', () => {
    const candidates = extractCandidates(page({ src: A, currentSrc: A }), 1);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.mediaUrl).toBe(A);
  });

  it('SPEC-0005:UT-02 vídeo com mediaKeys gera candidato protegido', () => {
    const candidates = extractCandidates(page({ src: A, currentSrc: A, hasMediaKeys: true }), 1);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.protection).toBe('drm');
  });

  it('SPEC-0005:UT-02 src blob: gera candidato unsupported-stream', () => {
    const blob = 'blob:https://site.example.test/3f1c-uuid';
    const candidates = extractCandidates(page({ src: blob, currentSrc: blob }), 1);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ mediaUrl: blob, support: 'unsupported-stream' });
  });

  it('SPEC-0005:UT-02 página sem vídeos não gera candidatos', () => {
    expect(
      extractCandidates({ pageUrl: 'https://x.test/', pageTitle: 'x', videos: [] }, 1),
    ).toEqual([]);
  });
});
