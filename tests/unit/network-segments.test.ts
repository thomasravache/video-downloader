/**
 * Contrato usado (SPEC-0024:UT-04, UT-05), src/core/network.ts:
 *   isManifestSegment(file: VideoCandidate, manifests: readonly VideoCandidate[]): boolean
 *     true quando `file` está na mesma origem e no diretório (ou subdiretório) de um manifesto hls/dash.
 *   Service.onNetworkResponse: com um manifesto hls/dash na aba, um `file` que é segmento dele não entra na lista.
 *   NetworkStore.add: acima de MAX_PER_TAB saem primeiro os candidatos `file` mais antigos; manifestos só por último.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PER_TAB, isManifestSegment } from '../../src/core/network';
import { HLS_TYPE, candidate, newStore, response, setupService } from './support/detect-service';

const MASTER = 'https://cdn.x/v/abc/master.m3u8';
const SEGMENT = 'https://cdn.x/v/abc/720/seg-1.mp4';
const OTHER = 'https://cdn.x/outro/video.mp4';
const KB = 1024;

const hls = (url: string) => candidate(1, url, { kind: 'hls', support: 'unsupported-stream' });
const file = (url: string) => candidate(1, url, { kind: 'file', sizeBytes: 200 * KB });

describe('isManifestSegment (D5)', () => {
  it('SPEC-0024:UT-04 .mp4 no subdiretório do master é segmento; .mp4 em outro diretório não é', () => {
    expect(isManifestSegment(file(SEGMENT), [hls(MASTER)])).toBe(true);
    expect(isManifestSegment(file('https://cdn.x/v/abc/seg-2.mp4'), [hls(MASTER)])).toBe(true);
    expect(isManifestSegment(file(OTHER), [hls(MASTER)])).toBe(false);
  });

  it('SPEC-0024:UT-04 outra origem, diretório pai ou nenhum manifesto: não é segmento', () => {
    expect(isManifestSegment(file('https://cdn2.x/v/abc/720/seg-1.mp4'), [hls(MASTER)])).toBe(
      false,
    );
    expect(isManifestSegment(file('https://cdn.x/v/seg-1.mp4'), [hls(MASTER)])).toBe(false);
    expect(isManifestSegment(file('https://cdn.x/v/abcdef/seg-1.mp4'), [hls(MASTER)])).toBe(false);
    expect(isManifestSegment(file(SEGMENT), [])).toBe(false);
  });

  it('SPEC-0024:UT-04 manifesto DASH também reivindica os segmentos da pasta', () => {
    const mpd = candidate(1, 'https://cdn.x/d/xyz/manifest.mpd', {
      kind: 'dash',
      support: 'unsupported-stream',
    });

    expect(isManifestSegment(file('https://cdn.x/d/xyz/video/seg-1.mp4'), [mpd])).toBe(true);
  });

  it('SPEC-0024:UT-04 o segmento de 200 KB que chega depois do master não entra na lista; o master continua e o .mp4 de outra pasta entra', async () => {
    const { service, network } = setupService();
    await service.onNetworkResponse(
      response({ url: MASTER, contentType: HLS_TYPE, contentLength: 900 }),
    );

    await service.onNetworkResponse(
      response({ url: SEGMENT, contentType: 'video/mp4', contentLength: 200 * KB }),
    );
    expect((await network.forTab(1)).map((c) => c.mediaUrl)).toEqual([MASTER]);

    await service.onNetworkResponse(
      response({ url: OTHER, contentType: 'video/mp4', contentLength: 200 * KB }),
    );
    expect((await network.forTab(1)).map((c) => c.mediaUrl).sort()).toEqual([MASTER, OTHER].sort());
  });
});

describe('NetworkStore: teto por aba preserva manifestos (D5)', () => {
  it('SPEC-0024:UT-05 1 manifesto e 60 file distintos: o manifesto continua e restam os 49 file mais recentes', async () => {
    const store = newStore();
    const fileUrl = (n: number) => `https://media.example.test/f/${String(n)}.mp4`;
    await store.add(1, hls(MASTER));
    for (let n = 0; n < 60; n++) {
      await store.add(1, file(fileUrl(n)));
    }

    const all = await store.forTab(1);

    expect(all).toHaveLength(MAX_PER_TAB);
    expect(all.filter((c) => c.kind === 'hls').map((c) => c.mediaUrl)).toEqual([MASTER]);
    const files = all.filter((c) => c.kind === 'file').map((c) => c.mediaUrl);
    expect(files).toEqual(Array.from({ length: 49 }, (_, i) => fileUrl(59 - i)));
  });
});
