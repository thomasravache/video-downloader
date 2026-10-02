/**
 * Contrato usado (SPEC-0009:UT-01..UT-03):
 *   src/core/frames.ts -> findCrossOriginFrames(iframeSrcs: readonly string[], pageOrigin: string): string[]
 *                         mergeFrameSnapshots(frames: readonly FrameSnapshot[], tabId: number): VideoCandidate[]
 *                         computeBlockedOrigins(seen: readonly string[], pageOrigin: string,
 *                                               granted: ReadonlySet<string>): string[]
 *   src/core/contracts -> FrameSnapshot { frameId, snapshot: PageSnapshot (com crossOriginFrames) },
 *                         VideoCandidate.frameId / frameUrl
 *   src/core/candidates -> candidateId(tabId, mediaUrl) (oráculo dos ids)
 *
 * `pageOrigin` é a origem do frame que contém os iframes, no formato 'https://host[:porta]' (sem
 * barra final); `src` relativo resolve contra ela. `granted` guarda ORIGENS (não padrões 'o/*').
 */
import { describe, expect, it } from 'vitest';
import { candidateId } from '../../src/core/candidates';
import type { FrameSnapshot, PageSnapshot, VideoSnapshot } from '../../src/core/contracts';
import {
  computeBlockedOrigins,
  findCrossOriginFrames,
  mergeFrameSnapshots,
} from '../../src/core/frames';

const PAGE_ORIGIN = 'https://site.example.test';

describe('findCrossOriginFrames', () => {
  it('SPEC-0009:UT-01 devolve só as origens http(s) distintas da página, sem repetição, caminho ou query', () => {
    const result = findCrossOriginFrames(
      [
        'https://player.cdn.example.test/embed/123?autoplay=1#t=5',
        'https://player.cdn.example.test/embed/456',
        'http://localhost:8080/pagina.html',
        'https://site.example.test/outro-frame.html',
        'https://site.example.test:8443/porta-diferente.html',
        '/relativo/da/mesma/origem.html',
        'player.html',
        'about:blank',
        'data:text/html,<p>oi</p>',
        'javascript:void(0)',
        '',
      ],
      PAGE_ORIGIN,
    );

    expect([...result].sort()).toEqual(
      [
        'http://localhost:8080',
        'https://player.cdn.example.test',
        'https://site.example.test:8443',
      ].sort(),
    );
  });

  it('SPEC-0009:UT-01 página sem iframes úteis devolve lista vazia', () => {
    expect(findCrossOriginFrames([], PAGE_ORIGIN)).toEqual([]);
    expect(
      findCrossOriginFrames(
        ['about:blank', '', '/x.html', 'https://site.example.test/y'],
        PAGE_ORIGIN,
      ),
    ).toEqual([]);
  });

  it('SPEC-0009:UT-01 porta padrão explícita é a mesma origem do host sem porta', () => {
    expect(
      findCrossOriginFrames(
        ['https://site.example.test:443/a.html', 'https://player.example.test:443/b.html'],
        PAGE_ORIGIN,
      ),
    ).toEqual(['https://player.example.test']);
  });
});

const MAIN_URL = 'https://site.example.test/aula';
const SAME_ORIGIN_URL = 'https://site.example.test/embed/mesma-origem';
const OTHER_ORIGIN_URL = 'https://player.example.test/embed/1';
const A = 'https://cdn.example.test/a.mp4';
const B = 'https://cdn.example.test/b.webm';
const C = 'https://player.example.test/c.mp4';

function video(url: string): VideoSnapshot {
  return { src: url, currentSrc: url, sources: [], hasMediaKeys: false, encrypted: false };
}

function frame(frameId: number, pageUrl: string, urls: string[]): FrameSnapshot {
  const snapshot: PageSnapshot = {
    pageUrl,
    pageTitle: `Frame ${String(frameId)}`,
    videos: urls.map(video),
    crossOriginFrames: [],
  };
  return { frameId, snapshot };
}

describe('mergeFrameSnapshots', () => {
  const main = frame(0, MAIN_URL, [A]);
  const same = frame(3, SAME_ORIGIN_URL, [A, B]);
  const other = frame(5, OTHER_ORIGIN_URL, [C]);

  it('SPEC-0009:UT-02 atribui frameId/frameUrl do frame de origem e a URL repetida aparece uma vez (menor frameId)', () => {
    // fora de ordem de propósito: o menor frameId vence, não o primeiro da lista
    const candidates = mergeFrameSnapshots([other, same, main], 7);

    expect(candidates).toHaveLength(3);
    const byUrl = new Map(candidates.map((c) => [c.mediaUrl, c]));
    expect(byUrl.get(A)).toMatchObject({ frameId: 0, frameUrl: MAIN_URL, tabId: 7 });
    expect(byUrl.get(B)).toMatchObject({ frameId: 3, frameUrl: SAME_ORIGIN_URL, tabId: 7 });
    expect(byUrl.get(C)).toMatchObject({ frameId: 5, frameUrl: OTHER_ORIGIN_URL, tabId: 7 });
    for (const c of candidates) {
      expect(c).toMatchObject({ protection: 'none', support: 'downloadable' });
    }
  });

  it('SPEC-0009:UT-02 os ids são estáveis, vêm de (tabId, mediaUrl) e não dependem do frame nem da ordem', () => {
    const first = mergeFrameSnapshots([main, same, other], 7);
    const second = mergeFrameSnapshots([other, same, main], 7);
    const otherTab = mergeFrameSnapshots([main, same, other], 8);

    const ids = (list: typeof first) => new Map(list.map((c) => [c.mediaUrl, c.id]));
    expect(ids(second)).toEqual(ids(first));
    expect(ids(first).get(A)).toBe(candidateId(7, A));
    expect(ids(first).get(C)).toBe(candidateId(7, C));
    expect(new Set(first.map((c) => c.id)).size).toBe(3);
    expect(ids(otherTab).get(A)).not.toBe(ids(first).get(A));
  });

  it('SPEC-0009:UT-02 lista vazia de frames ou frames sem vídeo não geram candidatos', () => {
    expect(mergeFrameSnapshots([], 1)).toEqual([]);
    expect(mergeFrameSnapshots([frame(0, MAIN_URL, [])], 1)).toEqual([]);
  });
});

describe('computeBlockedOrigins', () => {
  it('SPEC-0009:UT-03 devolve só as origens não concedidas e diferentes da página, ordenadas e sem repetição', () => {
    const blocked = computeBlockedOrigins(
      [
        'https://z.example.test',
        'https://a.example.test',
        'https://z.example.test',
        'https://site.example.test',
        'https://granted.example.test',
        'http://localhost:8080',
      ],
      PAGE_ORIGIN,
      new Set(['https://granted.example.test']),
    );

    expect(blocked).toEqual([
      'http://localhost:8080',
      'https://a.example.test',
      'https://z.example.test',
    ]);
  });

  it('SPEC-0009:UT-03 origens não http(s) são descartadas', () => {
    expect(
      computeBlockedOrigins(
        [
          'ftp://files.example.test',
          'about:blank',
          'javascript:void(0)',
          'https://ok.example.test',
        ],
        PAGE_ORIGIN,
        new Set(),
      ),
    ).toEqual(['https://ok.example.test']);
  });

  it('SPEC-0009:UT-03 tudo concedido (ou nada visto) devolve lista vazia', () => {
    expect(
      computeBlockedOrigins(
        ['https://a.example.test', 'https://b.example.test'],
        PAGE_ORIGIN,
        new Set(['https://a.example.test', 'https://b.example.test']),
      ),
    ).toEqual([]);
    expect(computeBlockedOrigins([], PAGE_ORIGIN, new Set())).toEqual([]);
  });
});
