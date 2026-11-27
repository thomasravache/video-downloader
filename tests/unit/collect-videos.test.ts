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

/**
 * Contrato usado (SPEC-0024:UT-03): `collectVideos` percorre `document` e os shadow roots ABERTOS
 * (`element.shadowRoot`), até a profundidade 8 (o `document` é a profundidade 0; o shadow root de um elemento
 * do `document` é a 1), e devolve o mesmo `PageSnapshot`. O DOM falso entende `querySelectorAll` com
 * `video`, `iframe[src]`, `:scope > source[src]` e `*` (todos os elementos daquela raiz, sem entrar em shadow
 * roots) e expõe `children`/`shadowRoot` em cada elemento.
 */
interface FakeElement {
  tagName: string;
  shadowRoot: FakeRoot | null;
  children: FakeElement[];
  querySelectorAll(selector: string): FakeElement[];
  getAttribute(name: string): string | null;
  [key: string]: unknown;
}
interface FakeRoot {
  children: FakeElement[];
  querySelectorAll(selector: string): FakeElement[];
}

function fakeRoot(children: FakeElement[]): FakeRoot {
  const all = (): FakeElement[] => children.flatMap((c) => [c, ...descendants(c)]);
  return {
    children,
    querySelectorAll: (selector) => select(all(), selector),
  };
}
function descendants(element: FakeElement): FakeElement[] {
  return element.children.flatMap((c) => [c, ...descendants(c)]);
}
function select(elements: FakeElement[], selector: string): FakeElement[] {
  if (selector === '*') {
    return elements;
  }
  if (selector.startsWith('video')) {
    return elements.filter((e) => e.tagName === 'VIDEO');
  }
  if (selector.startsWith('iframe')) {
    return elements.filter((e) => e.tagName === 'IFRAME');
  }
  return [];
}
function fakeVideo(src: string): FakeElement {
  return {
    tagName: 'VIDEO',
    shadowRoot: null,
    children: [],
    src,
    currentSrc: src,
    mediaKeys: null,
    addEventListener: () => undefined,
    querySelectorAll: () => [],
    getAttribute: (name) => (name === 'src' ? src : null),
  };
}
function host(shadowChildren: FakeElement[], lightChildren: FakeElement[] = []): FakeElement {
  return {
    tagName: 'VIDEO-PLAYER',
    shadowRoot: fakeRoot(shadowChildren),
    children: lightChildren,
    querySelectorAll: (selector) =>
      select(
        lightChildren.flatMap((c) => [c, ...descendants(c)]),
        selector,
      ),
    getAttribute: () => null,
  };
}
function stubDocument(children: FakeElement[]): void {
  const root = fakeRoot(children);
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { href: PAGE_URL, origin: PAGE_ORIGIN });
  vi.stubGlobal('document', {
    title: 'Aula',
    children: root.children,
    documentElement: { children: root.children },
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
  });
}

describe('collectVideos: shadow DOM (D3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LIGHT = 'https://cdn.example.test/light.mp4';
  const OUTER = 'https://cdn.example.test/shadow-1.mp4';
  const INNER = 'https://cdn.example.test/shadow-2.mp4';

  it('SPEC-0024:UT-03 <video src> num shadow root aberto e noutro aninhado entram no snapshot', () => {
    stubDocument([fakeVideo(LIGHT), host([fakeVideo(OUTER), host([fakeVideo(INNER)])])]);

    const srcs = collectVideos().videos.map((v) => v.src);

    expect([...srcs].sort()).toEqual([INNER, LIGHT, OUTER].sort());
  });

  it('SPEC-0024:UT-03 aninhamento além da profundidade 8 é ignorado sem erro', () => {
    const DEEP = 'https://cdn.example.test/deep.mp4';
    let nested: FakeElement = host([fakeVideo(DEEP)]);
    for (let depth = 1; depth < 12; depth++) {
      nested = host([nested]);
    }
    stubDocument([host([fakeVideo(OUTER)]), nested]);

    const snapshot = collectVideos();

    expect(snapshot.videos.map((v) => v.src)).toEqual([OUTER]);
    expect(snapshot.pageUrl).toBe(PAGE_URL);
  });
});
