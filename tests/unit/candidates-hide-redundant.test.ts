/**
 * Contrato usado (SPEC-0013 §6): `hideRedundantCandidates(list)` em src/core/candidates.ts remove os
 * candidatos com `support === 'unsupported-stream'` E `mediaUrl` que não é http(s) (ex.: `blob:`) quando a
 * lista tem ao menos um OUTRO candidato `support === 'downloadable'` ou `kind === 'hls'`. Caso contrário
 * devolve a lista inalterada. Preserva a ordem e não muta a entrada.
 */
import { describe, expect, it } from 'vitest';
import { hideRedundantCandidates } from '../../src/core/candidates';
import type { VideoCandidate } from '../../src/core/contracts';

function make(id: string, over: Partial<VideoCandidate> = {}): VideoCandidate {
  return {
    id,
    providerId: 'generic',
    tabId: 1,
    pageUrl: 'https://site.example.test/aula',
    mediaUrl: `https://cdn.example.test/${id}.mp4`,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: 'https://site.example.test/aula',
    kind: 'file',
    source: 'dom',
    ...over,
  };
}
const blob = (id = 'blob', over: Partial<VideoCandidate> = {}): VideoCandidate =>
  make(id, {
    mediaUrl: `blob:https://site.example.test/${id}-uuid`,
    support: 'unsupported-stream',
    ...over,
  });
const ids = (list: VideoCandidate[]): string[] => list.map((c) => c.id);

describe('hideRedundantCandidates', () => {
  it('SPEC-0013:UT-09 blob + arquivo baixável: o blob some e a ordem dos demais é preservada', () => {
    const input = [make('a'), blob(), make('b')];

    expect(ids(hideRedundantCandidates(input))).toEqual(['a', 'b']);
  });

  it('SPEC-0013:UT-09 blob + HLS (mesmo não resolvido/unsupported-stream): o blob some', () => {
    const hls = make('h', {
      kind: 'hls',
      mediaUrl: 'https://cdn.example.test/p.m3u8',
      source: 'network',
    });

    expect(ids(hideRedundantCandidates([blob(), hls]))).toEqual(['h']);
    expect(
      ids(hideRedundantCandidates([hls, blob()].map((c) => ({ ...c, protection: 'encrypted' })))),
    ).toEqual(['h']);
  });

  it('SPEC-0013:UT-09 blob sozinho: a lista fica inalterada', () => {
    const input = [blob()];

    expect(ids(hideRedundantCandidates(input))).toEqual(['blob']);
  });

  it('SPEC-0013:UT-09 blob + só outro unsupported-stream (não http, sem HLS): nada some', () => {
    const input = [blob('b1'), blob('b2')];

    expect(ids(hideRedundantCandidates(input))).toEqual(['b1', 'b2']);
  });

  it('SPEC-0013:UT-09 sem blob: a lista fica igual (inclusive unsupported-stream http(s) e só arquivos)', () => {
    const remote = make('m', { support: 'unsupported-stream' });
    const input = [make('a'), remote, make('b')];

    expect(ids(hideRedundantCandidates(input))).toEqual(['a', 'm', 'b']);
    expect(ids(hideRedundantCandidates([make('a'), make('b')]))).toEqual(['a', 'b']);
  });

  it('SPEC-0013:UT-09 não muta a entrada e não remove o candidato que justifica a remoção', () => {
    const input = [blob(), make('a'), blob('b2')];
    const snapshot = structuredClone(input);

    const result = hideRedundantCandidates(input);

    expect(input).toEqual(snapshot);
    expect(ids(result)).toEqual(['a']);
    expect(result).not.toBe(input);
  });
});
