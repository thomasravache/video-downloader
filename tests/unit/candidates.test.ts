/**
 * Contrato usado (SPEC-0005:UT-06):
 *   src/core/candidates.ts -> createCandidateStore(): { replaceTab, forTab, find, removeTab }
 */
import { describe, expect, it } from 'vitest';
import { createCandidateStore } from '../../src/core/candidates';
import type { VideoCandidate } from '../../src/core/contracts';

function candidate(tabId: number, id: string): VideoCandidate {
  return {
    id,
    providerId: 'generic',
    tabId,
    pageUrl: 'https://site.example.test/',
    mediaUrl: `https://cdn.example.test/${id}.mp4`,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: 'https://site.example.test/',
    kind: 'file',
    source: 'dom',
  };
}

describe('candidate store', () => {
  it('SPEC-0005:UT-06 ao fechar a aba 1 o agregador mantém só os candidatos da aba 2', () => {
    const store = createCandidateStore();
    store.replaceTab(1, [candidate(1, 'a'), candidate(1, 'b')]);
    store.replaceTab(2, [candidate(2, 'c')]);

    store.removeTab(1);

    expect(store.forTab(1)).toEqual([]);
    expect(store.find('a')).toBeUndefined();
    expect(store.find('b')).toBeUndefined();
    expect(store.forTab(2).map((c) => c.id)).toEqual(['c']);
    expect(store.find('c')?.tabId).toBe(2);
  });

  it('SPEC-0005:UT-06 nova detecção na mesma aba substitui os candidatos anteriores', () => {
    const store = createCandidateStore();
    store.replaceTab(1, [candidate(1, 'a')]);

    store.replaceTab(1, [candidate(1, 'b')]);

    expect(store.forTab(1).map((c) => c.id)).toEqual(['b']);
    expect(store.find('a')).toBeUndefined();
  });

  it('SPEC-0005:UT-06 find devolve undefined para candidato desconhecido', () => {
    expect(createCandidateStore().find('nope')).toBeUndefined();
  });
});
