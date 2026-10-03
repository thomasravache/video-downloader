/**
 * Contrato usado (SPEC-0013 §6): `mergeCandidates(dom, network)` (src/core/network.ts), regra nova além da
 * igualdade exata de URL: um candidato DOM `kind === 'file'` é SUBSTITUÍDO por um candidato de rede
 * `kind === 'hls'` quando ambos têm a mesma origem+caminho (query e fragmento ignorados); o substituto herda
 * o `title` do DOM se não tiver. Outros pares com mesma origem+caminho e query diferente seguem separados.
 */
import { describe, expect, it } from 'vitest';
import type { VideoCandidate } from '../../src/core/contracts';
import { mergeCandidates } from '../../src/core/network';

function make(mediaUrl: string, over: Partial<VideoCandidate> = {}): VideoCandidate {
  return {
    id: `id-${mediaUrl}`,
    providerId: 'generic',
    tabId: 1,
    pageUrl: 'https://h/aula',
    mediaUrl,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: 'https://h/aula',
    kind: 'file',
    source: 'dom',
    ...over,
  };
}

describe('mergeCandidates: master vista como arquivo', () => {
  it('SPEC-0013:UT-10 DOM file + rede hls (mesma origem+caminho, query diferente): um só candidato hls com o título do DOM', () => {
    const dom = make('https://h/x/0dc195?sig=a', { title: 'Aula 1 - Introdução' });
    const net = make('https://h/x/0dc195?sig=b', {
      kind: 'hls',
      source: 'network',
      support: 'unsupported-stream',
    });

    const merged = mergeCandidates([dom], [net]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kind: 'hls',
      source: 'network',
      mediaUrl: 'https://h/x/0dc195?sig=b',
      title: 'Aula 1 - Introdução',
    });
  });

  it('SPEC-0013:UT-10 o hls da rede que já tem título o mantém; fragmento também é ignorado', () => {
    const dom = make('https://h/x/0dc195#t=1', { title: 'DOM' });
    const net = make('https://h/x/0dc195?sig=b', {
      kind: 'hls',
      source: 'network',
      title: 'Rede',
    });

    const merged = mergeCandidates([dom], [net]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ kind: 'hls', title: 'Rede' });
  });

  it('SPEC-0013:UT-10 (guarda) dois arquivos file com mesma origem+caminho e queries diferentes continuam separados', () => {
    const merged = mergeCandidates(
      [make('https://h/x/0dc195?sig=a')],
      [make('https://h/x/0dc195?sig=b', { source: 'network' })],
    );

    expect(merged.map((c) => c.mediaUrl)).toEqual([
      'https://h/x/0dc195?sig=a',
      'https://h/x/0dc195?sig=b',
    ]);
  });

  it('SPEC-0013:UT-10 (guarda) origem ou caminho diferente não substitui; DOM hls não é substituído', () => {
    const otherPath = mergeCandidates(
      [make('https://h/x/0dc195?sig=a')],
      [make('https://h/x/outro?sig=b', { kind: 'hls', source: 'network' })],
    );
    const otherOrigin = mergeCandidates(
      [make('https://h/x/0dc195?sig=a')],
      [make('https://cdn/x/0dc195?sig=b', { kind: 'hls', source: 'network' })],
    );
    const domHls = mergeCandidates(
      [make('https://h/x/0dc195?sig=a', { kind: 'hls' })],
      [make('https://h/x/0dc195?sig=b', { kind: 'hls', source: 'network' })],
    );

    expect(otherPath.map((c) => c.kind)).toEqual(['file', 'hls']);
    expect(otherOrigin.map((c) => c.kind)).toEqual(['file', 'hls']);
    expect(domHls).toHaveLength(2);
  });
});
