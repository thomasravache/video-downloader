/**
 * Contrato usado (SPEC-0024:UT-13):
 *   src/core/candidates.ts -> groupKey(url): string
 *     origem + caminho + query SEM os parâmetros de assinatura, em ordem; parâmetros de assinatura (sem diferenciar
 *     maiúsculas): token, sig, signature, expires, exp, policy, key-pair-id, hdnts, hdnea, hmac, auth, acl,
 *     x-amz-*, x-goog-*.
 *   groupCandidates (SPEC-0015) e mergeCandidates (SPEC-0010/0013) passam a comparar por `groupKey` em vez de
 *   origem + caminho: manifestos no mesmo caminho só se juntam com a mesma query sem assinatura.
 */
import { describe, expect, it } from 'vitest';
import { groupCandidates, groupKey } from '../../src/core/candidates';
import type { VideoCandidate } from '../../src/core/contracts';
import type { HlsInfo } from '../../src/core/hls';
import { mergeCandidates } from '../../src/core/network';

const BASE = 'https://cdn.x/hls/playlist.m3u8';

function master(mediaUrl: string, variantUrl: string): VideoCandidate {
  const hls: HlsInfo = {
    type: 'master',
    variants: [{ index: 0, url: variantUrl, bandwidth: 2_000_000, height: 720, label: '720p' }],
    encrypted: false,
    live: false,
    fmp4: false,
  };
  return {
    id: `m-${mediaUrl}`,
    providerId: 'network',
    tabId: 1,
    pageUrl: 'https://site.x/aula',
    mediaUrl,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: 'https://site.x/aula',
    kind: 'hls',
    source: 'network',
    hls,
  };
}

function unresolved(mediaUrl: string): VideoCandidate {
  const { hls: _hls, ...rest } = master(mediaUrl, mediaUrl);
  return { ...rest, id: `u-${mediaUrl}`, support: 'unsupported-stream' };
}

describe('groupKey (D9)', () => {
  it('SPEC-0024:UT-13 mesmo caminho com id diferente na query dá chaves diferentes', () => {
    expect(groupKey(`${BASE}?id=A`)).not.toBe(groupKey(`${BASE}?id=B`));
  });

  it('SPEC-0024:UT-13 mesma aula com assinatura diferente e outra ordem dá a mesma chave', () => {
    expect(groupKey(`${BASE}?id=A&token=1&Expires=9`)).toBe(
      groupKey(`${BASE}?Expires=3&id=A&token=2`),
    );
  });

  it('SPEC-0024:UT-13 todos os parâmetros de assinatura saem, sem diferenciar maiúsculas', () => {
    const signed =
      `${BASE}?id=A&TOKEN=t&Sig=s&signature=x&exp=1&Policy=p&Key-Pair-Id=k&hdnts=h1&HDNEA=h2` +
      '&hmac=m&Auth=a&acl=c&X-Amz-Signature=z&x-amz-date=d&X-Goog-Signature=g&x-goog-expires=e';

    expect(groupKey(signed)).toBe(groupKey(`${BASE}?id=A`));
  });

  it('SPEC-0024:UT-13 a ordem dos demais parâmetros não importa; valor, caminho ou origem diferentes importam', () => {
    expect(groupKey(`${BASE}?b=2&a=1`)).toBe(groupKey(`${BASE}?a=1&b=2`));
    expect(groupKey(`${BASE}?a=1&b=3`)).not.toBe(groupKey(`${BASE}?a=1&b=2`));
    expect(groupKey('https://cdn.x/hls/outra.m3u8?id=A')).not.toBe(groupKey(`${BASE}?id=A`));
    expect(groupKey('https://cdn2.x/hls/playlist.m3u8?id=A')).not.toBe(groupKey(`${BASE}?id=A`));
  });
});

describe('agrupamento por groupKey (D9)', () => {
  it('SPEC-0024:UT-13 aulas ?id=A e ?id=B no mesmo caminho viram dois cartões', () => {
    const a = master(`${BASE}?id=A`, `${BASE}?id=A&rendition=720`);
    const b = unresolved(`${BASE}?id=B`);

    const groups = groupCandidates([a, b]);

    expect(groups.map((g) => g.primary.mediaUrl)).toEqual([a.mediaUrl, b.mediaUrl]);
    expect(groups.map((g) => g.related.length)).toEqual([0, 0]);
  });

  it('SPEC-0024:UT-13 (guarda: passa antes da mudança) a mesma aula com outra assinatura é recolhida como fonte do mesmo cartão', () => {
    const a = master(`${BASE}?id=A&token=1`, `${BASE}?id=A&token=1&Expires=9`);
    const again = unresolved(`${BASE}?Expires=3&id=A&token=2`);

    const groups = groupCandidates([a, again]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.mediaUrl).toBe(a.mediaUrl);
    expect(groups[0]?.related.map((c) => c.mediaUrl)).toEqual([again.mediaUrl]);
  });

  it('SPEC-0024:UT-13 mergeCandidates: o HLS de rede ?id=A não substitui o file do DOM ?id=B; com a mesma aula assinada, substitui', () => {
    const domFile = (mediaUrl: string): VideoCandidate => ({
      ...unresolved(mediaUrl),
      id: `d-${mediaUrl}`,
      kind: 'file',
      source: 'dom',
      support: 'downloadable',
    });

    const distinct = mergeCandidates([domFile(`${BASE}?id=B`)], [unresolved(`${BASE}?id=A`)]);
    const same = mergeCandidates(
      [domFile(`${BASE}?id=A&token=1`)],
      [unresolved(`${BASE}?id=A&token=2`)],
    );

    expect(distinct.map((c) => [c.kind, c.mediaUrl])).toEqual([
      ['file', `${BASE}?id=B`],
      ['hls', `${BASE}?id=A`],
    ]);
    expect(same.map((c) => [c.kind, c.mediaUrl])).toEqual([['hls', `${BASE}?id=A&token=2`]]);
  });
});
