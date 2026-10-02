/**
 * Contrato usado (SPEC-0010:UT-02, UT-03), proposto em src/core/network.ts:
 *   SessionStoragePort { get(key), set(key, value), remove(key) }   (porta de storage.session)
 *   new NetworkStore(port, now?) { add(tabId, candidate), forTab(tabId) (mais recentes primeiro), clear(tabId) }
 *     chave por aba: 'vd:net:<tabId>'; dedupe por URL sem fragmento; no máximo 50 por aba
 *   mergeCandidates(dom, network): dedupe por URL sem fragmento; o candidato do DOM prevalece
 *   VideoCandidate v3: kind 'file'|'hls'|'dash', source 'dom'|'network' (src/core/contracts)
 */
import { describe, expect, it } from 'vitest';
import type { VideoCandidate } from '../../src/core/contracts';
import { NetworkStore, mergeCandidates } from '../../src/core/network';
import type { SessionStoragePort } from '../../src/core/network';

/** Porta em memória que imita storage.session: valores passam por clonagem estruturada. */
function memoryPort(): SessionStoragePort & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key) => Promise.resolve(data.has(key) ? structuredClone(data.get(key)) : undefined),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

function candidate(
  tabId: number,
  mediaUrl: string,
  overrides: Partial<VideoCandidate> = {},
): VideoCandidate {
  return {
    id: `id-${String(tabId)}-${mediaUrl}`,
    providerId: 'generic',
    tabId,
    pageUrl: 'https://site.example.test/aula',
    mediaUrl,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: 'https://site.example.test/aula',
    kind: 'file',
    source: 'network',
    ...overrides,
  };
}

const url = (n: number) => `https://cdn.example.test/v/${String(n)}.mp4`;

function newStore(port = memoryPort()) {
  let clock = 1_000;
  return new NetworkStore(port, () => ++clock);
}

describe('NetworkStore', () => {
  it('SPEC-0010:UT-02 60 candidatos distintos: guarda os 50 mais recentes, o mais novo primeiro', async () => {
    const store = newStore();
    for (let n = 0; n < 60; n++) {
      await store.add(1, candidate(1, url(n)));
    }

    const urls = (await store.forTab(1)).map((c) => c.mediaUrl);

    expect(urls).toHaveLength(50);
    expect(urls[0]).toBe(url(59));
    expect(urls[49]).toBe(url(10));
    expect(urls).not.toContain(url(9));
  });

  it('SPEC-0010:UT-02 duplicatas (mesma URL, inclusive só com fragmento diferente) ficam em um item', async () => {
    const store = newStore();
    await store.add(1, candidate(1, url(1)));
    await store.add(1, candidate(1, url(1)));
    await store.add(1, candidate(1, `${url(1)}#t=10`));
    await store.add(1, candidate(1, `${url(1)}#t=20`));
    await store.add(1, candidate(1, url(2)));

    const list = await store.forTab(1);

    expect(list).toHaveLength(2);
    expect(list.map((c) => c.mediaUrl.split('#')[0]).sort()).toEqual([url(1), url(2)]);
  });

  it('SPEC-0010:UT-02 70 inserções com repetições respeitam o limite e não têm URL repetida', async () => {
    const store = newStore();
    for (let n = 0; n < 70; n++) {
      await store.add(1, candidate(1, url(n % 60)));
    }

    const urls = (await store.forTab(1)).map((c) => c.mediaUrl);

    expect(urls.length).toBeLessThanOrEqual(50);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('SPEC-0010:UT-02 as abas são independentes e a chave da aba é vd:net:<tabId>', async () => {
    const port = memoryPort();
    const store = newStore(port);
    await store.add(1, candidate(1, url(1)));
    await store.add(2, candidate(2, url(2)));

    expect(port.data.has('vd:net:1')).toBe(true);
    expect(port.data.has('vd:net:2')).toBe(true);
    expect((await store.forTab(1)).map((c) => c.mediaUrl)).toEqual([url(1)]);
    expect((await store.forTab(2)).map((c) => c.mediaUrl)).toEqual([url(2)]);
    expect(await store.forTab(3)).toEqual([]);
  });

  it('SPEC-0010:UT-02 clear esvazia só a aba indicada e remove a chave dela', async () => {
    const port = memoryPort();
    const store = newStore(port);
    await store.add(1, candidate(1, url(1)));
    await store.add(2, candidate(2, url(2)));

    await store.clear(1);

    expect(await store.forTab(1)).toEqual([]);
    expect(port.data.has('vd:net:1')).toBe(false);
    expect((await store.forTab(2)).map((c) => c.mediaUrl)).toEqual([url(2)]);
  });

  it('SPEC-0010:UT-02 um repositório novo sobre a mesma porta enxerga os itens (estado vive na porta)', async () => {
    const port = memoryPort();
    await newStore(port).add(1, candidate(1, url(1)));

    expect((await newStore(port).forTab(1)).map((c) => c.mediaUrl)).toEqual([url(1)]);
  });
});

describe('mergeCandidates', () => {
  const dom = (mediaUrl: string) => candidate(1, mediaUrl, { source: 'dom' });
  const net = (mediaUrl: string) => candidate(1, mediaUrl, { source: 'network' });

  it('SPEC-0010:UT-03 a mesma URL nas duas fontes vira um candidato com source dom', () => {
    const merged = mergeCandidates([dom(url(1))], [net(url(1))]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ mediaUrl: url(1), source: 'dom' });
  });

  it('SPEC-0010:UT-03 URLs que diferem só pelo fragmento são a mesma; o do DOM vale', () => {
    const merged = mergeCandidates([dom(`${url(1)}#t=5`)], [net(url(1)), net(`${url(1)}#t=9`)]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ mediaUrl: `${url(1)}#t=5`, source: 'dom' });
  });

  it('SPEC-0010:UT-03 URLs distintas (inclusive só pela query) são mantidas, de DOM e de rede', () => {
    const merged = mergeCandidates(
      [dom(url(1)), dom(`${url(2)}?a=1`)],
      [net(url(3)), net(`${url(2)}?a=2`)],
    );

    expect(merged.map((c) => c.mediaUrl).sort()).toEqual(
      [url(1), `${url(2)}?a=1`, `${url(2)}?a=2`, url(3)].sort(),
    );
    expect(merged.filter((c) => c.source === 'dom')).toHaveLength(2);
  });

  it('SPEC-0010:UT-03 duplicatas dentro da própria lista de rede também colapsam', () => {
    const merged = mergeCandidates([], [net(url(1)), net(`${url(1)}#x`), net(url(2))]);

    expect(merged.map((c) => c.mediaUrl.split('#')[0]).sort()).toEqual([url(1), url(2)]);
  });

  it('SPEC-0011:UT-07 candidato DOM kind file e de rede kind hls com a mesma URL: prevalece o hls', () => {
    const merged = mergeCandidates(
      [candidate(1, url(1), { source: 'dom', kind: 'file' })],
      [candidate(1, url(1), { source: 'network', kind: 'hls' })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ mediaUrl: url(1), kind: 'hls', source: 'network' });
  });

  it('SPEC-0011:UT-07 guarda: mesma URL e mesmo kind (hls ou file) continua com o candidato do DOM', () => {
    for (const kind of ['file', 'hls'] as const) {
      const merged = mergeCandidates(
        [candidate(1, url(1), { source: 'dom', kind })],
        [candidate(1, url(1), { source: 'network', kind })],
      );

      expect(merged).toHaveLength(1);
      expect(merged[0], kind).toMatchObject({ kind, source: 'dom' });
    }
  });

  it('SPEC-0010:UT-03 listas vazias e entradas não são alteradas', () => {
    expect(mergeCandidates([], [])).toEqual([]);
    const domList = [dom(url(1))];
    const netList = [net(url(1)), net(url(2))];

    mergeCandidates(domList, netList);

    expect(domList).toHaveLength(1);
    expect(netList).toHaveLength(2);
  });
});
