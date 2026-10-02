/**
 * Paridade (SPEC-0009:UT-01): `collectVideos` (entrypoints/background/collect-videos.ts) é
 * serializada na página e por isso duplica a lógica de `findCrossOriginFrames`; este teste garante
 * que as duas implementações devolvem as mesmas origens para os mesmos `<iframe src>`.
 * O DOM é simulado com stubs mínimos (o ambiente de teste é node).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectVideos } from '../../entrypoints/background/collect-videos';
import { findCrossOriginFrames } from '../../src/core/frames';

const PAGE_URL = 'https://site.example.test/aula/1?x=1';
const PAGE_ORIGIN = 'https://site.example.test';

const SRCS = [
  'https://player.cdn.example.test/embed/123?autoplay=1#t=5',
  'https://player.cdn.example.test/embed/456',
  'http://localhost:8080/pagina.html',
  'https://site.example.test/outro-frame.html',
  'https://site.example.test:8443/porta-diferente.html',
  'https://site.example.test:443/mesma.html',
  '/relativo/da/mesma/origem.html',
  'player.html',
  '//cdn.example.test/protocolo-relativo.html',
  'about:blank',
  'data:text/html,<p>oi</p>',
  'javascript:void(0)',
  'http://[::1',
  '',
  '   ',
];

function stubPage(iframeSrcs: string[]): void {
  const iframes = iframeSrcs.map((src) => ({ getAttribute: () => src }));
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { href: PAGE_URL, origin: PAGE_ORIGIN });
  vi.stubGlobal('document', {
    title: 'Aula',
    querySelectorAll: (selector: string) => (selector === 'iframe[src]' ? iframes : []),
  });
}

describe('collectVideos: crossOriginFrames', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SPEC-0009:UT-01 devolve as mesmas origens que findCrossOriginFrames', () => {
    stubPage(SRCS);

    const collected = collectVideos().crossOriginFrames;

    expect([...collected].sort()).toEqual([...findCrossOriginFrames(SRCS, PAGE_ORIGIN)].sort());
    expect([...collected].sort()).toEqual([
      'http://localhost:8080',
      'https://cdn.example.test',
      'https://player.cdn.example.test',
      'https://site.example.test:8443',
    ]);
  });

  it('SPEC-0009:UT-01 página sem iframes devolve lista vazia', () => {
    stubPage([]);

    expect(collectVideos().crossOriginFrames).toEqual([]);
  });
});
