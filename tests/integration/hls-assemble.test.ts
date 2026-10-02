/**
 * Contrato usado (SPEC-0012:IT-01) — servidor HTTP de fixtures REAL (127.0.0.1) + montador REAL (Node):
 *  - src/core/hls-download/segments.ts  parseMediaSegments(text, baseUrl) -> { urls, initUrl?, durationSec, fmp4 }
 *    (URLs absolutas http(s) resolvidas contra a playlist; nunca devolve URL de outro esquema:
 *     lança HlsParseError ou as descarta);
 *  - src/core/hls-download/scheduler.ts runSegments com o `fetch` do Node;
 *  - entrypoints/offscreen/assemble.ts  assembleTs / assembleFmp4 (mux.js real);
 *  - o MP4 resultante é conferido com o leitor de caixas de tests/unit/support/mp4.ts (ftyp/moov/mdat, duração, tkhd).
 * Desempenho (informativo, sem limite): tempo de montagem de 200 MB sintéticos.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assembleFmp4, assembleTs } from '../../entrypoints/offscreen/assemble';
import { parseHlsPlaylist } from '../../src/core/hls';
import { parseMediaSegments, runSegments } from '../../src/core/hls-download';
import {
  CLIP_DURATION_SEC,
  clipText,
  concat,
  fmp4Init,
  fmp4Segments,
} from '../unit/support/hls-clip';
import { inspectMp4 } from '../unit/support/mp4';
import { clipRoutes, isPlaylistPath, isSegmentPath } from './support/hls-job';
import { startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';

let server: PlaylistServer;

beforeEach(async () => {
  server = await startPlaylistServer(clipRoutes());
});

afterEach(async () => {
  await server.close();
});

const urlOf = (path: string): string => `${server.origin}/hls/clip/${path}`;
const text = async (url: string): Promise<string> => (await fetch(url)).text();

/** Baixa e junta como o offscreen: playlist -> segmentos (concorrência 4) -> montagem. */
async function download(playlistUrl: string): Promise<Uint8Array> {
  const media = parseMediaSegments(await text(playlistUrl), playlistUrl);
  const fetchBytes = async (url: string, init: { signal: AbortSignal }) => {
    const response = await fetch(url, { signal: init.signal });
    if (!response.ok) {
      throw new Error(`status ${String(response.status)}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
  const segments = await runSegments({
    urls: media.urls,
    concurrency: 4,
    retries: 3,
    backoffMs: (n) => 250 * 2 ** n,
    fetch: fetchBytes,
    sleep: () => Promise.resolve(),
    signal: new AbortController().signal,
  });
  if (media.initUrl !== undefined) {
    const init = await fetchBytes(media.initUrl, { signal: new AbortController().signal });
    return assembleFmp4(init, segments);
  }
  return assembleTs(undefined, segments);
}

describe('leitura dos segmentos da playlist de mídia', () => {
  it('SPEC-0012:IT-01 as 3 URLs de segmento TS ficam absolutas, na ordem, e a duração soma ~6 s', () => {
    const playlistUrl = urlOf('v360.m3u8');

    const media = parseMediaSegments(clipText('v360.m3u8'), playlistUrl);

    expect(media.urls).toEqual([0, 1, 2].map((i) => urlOf(`v360-${String(i)}.mpegts`)));
    expect(media.initUrl).toBeUndefined();
    expect(media.fmp4).toBe(false);
    expect(Math.abs(media.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.1);
  });

  it('SPEC-0012:IT-01 playlist fMP4: devolve o init (EXT-X-MAP) absoluto e os segmentos .m4s', () => {
    const media = parseMediaSegments(clipText('fmp4/media.m3u8'), urlOf('fmp4/media.m3u8'));

    expect(media.fmp4).toBe(true);
    expect(media.initUrl).toBe(urlOf('fmp4/init.mp4'));
    expect(media.urls).toEqual([0, 1, 2].map((i) => urlOf(`fmp4/f-${String(i)}.m4s`)));
  });

  it('SPEC-0012:IT-01 a variante de uma master do clipe aponta para a playlist de mídia correta', () => {
    const info = parseHlsPlaylist(clipText('master.m3u8'), urlOf('master.m3u8'));

    expect(info.variants.map((v) => [v.index, v.label, v.url])).toEqual([
      [0, '360p', urlOf('v360.m3u8')],
      [1, '180p', urlOf('v180.m3u8')],
    ]);
  });

  it('SPEC-0012:IT-01 nunca devolve segmento ou init que não seja http(s)', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MAP:URI="file:///etc/passwd"',
      '#EXTINF:2.0,',
      'ok.ts',
      '#EXTINF:2.0,',
      'javascript:alert(1)',
      '#EXTINF:2.0,',
      'data:video/mp2t;base64,AAAA',
      '#EXTINF:2.0,',
      'ftp://host.test/x.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    let urls: string[] = [];
    let initUrl: string | undefined;
    try {
      ({ urls, initUrl } = parseMediaSegments(playlist, 'https://cdn.test/v/media.m3u8'));
    } catch (error) {
      expect((error as { code?: string }).code).toBe('HLS_PARSE_FAILED');
    }

    expect(urls.every((u) => /^https?:\/\//.test(u))).toBe(true);
    expect(initUrl === undefined || /^https?:\/\//.test(initUrl)).toBe(true);
  });

  it('SPEC-0012:IT-01 playlist master ou vazia lança HlsParseError', () => {
    expect(() => parseMediaSegments(clipText('master.m3u8'), urlOf('master.m3u8'))).toThrow(
      expect.objectContaining({ code: 'HLS_PARSE_FAILED' }),
    );
    expect(() => parseMediaSegments('', urlOf('x.m3u8'))).toThrow(
      expect.objectContaining({ code: 'HLS_PARSE_FAILED' }),
    );
  });
});

describe('download + montagem contra o servidor de fixtures real', () => {
  it('SPEC-0012:IT-01 HLS TS 640x360: MP4 válido (ftyp/moov/mdat), ~6 s e 640x360', async () => {
    const mp4 = await download(urlOf('v360.m3u8'));

    const info = inspectMp4(mp4);
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'mdat']));
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([640, 360]);
    expect(info.tracks.some((t) => t.handler === 'soun')).toBe(true);
  });

  it('SPEC-0012:IT-01 HLS TS 320x180: a outra qualidade sai com a resolução dela', async () => {
    const info = inspectMp4(await download(urlOf('v180.m3u8')));

    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
  });

  it('SPEC-0012:IT-01 HLS fMP4 (EXT-X-MAP): init + segmentos concatenados, MP4 válido de ~6 s e 320x180', async () => {
    const mp4 = await download(urlOf('fmp4/media.m3u8'));

    expect(mp4).toEqual(concat([fmp4Init(), ...fmp4Segments()]));
    const info = inspectMp4(mp4);
    expect(info.topLevel).toEqual(expect.arrayContaining(['ftyp', 'moov', 'mdat']));
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
  });

  it('SPEC-0012:IT-01 só playlist e segmentos do vídeo são requisitados (nenhuma outra variante)', async () => {
    await download(urlOf('v360.m3u8'));

    const paths = server.requests.map((r) => r.split('?')[0] ?? '');
    expect(paths.filter(isPlaylistPath)).toEqual(['/hls/clip/v360.m3u8']);
    expect(paths.filter(isSegmentPath).sort()).toEqual(
      [0, 1, 2].map((i) => `/hls/clip/v360-${String(i)}.mpegts`).sort(),
    );
    expect(paths).toHaveLength(4);
  });

  it('SPEC-0012:IT-01 segmento com falhas transitórias (500 duas vezes) é retentado e o MP4 sai válido', async () => {
    await server.close();
    let hits = 0;
    const routes = clipRoutes();
    const real = routes['/hls/clip/v360-1.mpegts'];
    routes['/hls/clip/v360-1.mpegts'] = (req, res) => {
      hits += 1;
      if (hits <= 2) {
        res.writeHead(500, { 'content-type': 'text/plain' }).end('erro');
        return;
      }
      real?.(req, res);
    };
    server = await startPlaylistServer(routes);

    const info = inspectMp4(await download(urlOf('v360.m3u8')));

    expect(hits).toBe(3);
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
  });
});

describe('desempenho da montagem (informativo, sem limite)', () => {
  it('SPEC-0012:IT-01 montar 200 MB sintéticos de fMP4 e registrar o tempo', async () => {
    const init = fmp4Init();
    const chunk = new Uint8Array(10 * 1024 * 1024).fill(0x5a);
    const segments = Array.from({ length: 20 }, () => chunk);

    const started = performance.now();
    const out = await assembleFmp4(init, segments);
    const elapsedMs = Math.round(performance.now() - started);

    console.info(`[SPEC-0012:IT-01] assembleFmp4 de ~200 MB: ${String(elapsedMs)} ms`);
    expect(out.byteLength).toBe(init.byteLength + 20 * chunk.byteLength);
    expect(out.subarray(0, 8)).toEqual(init.subarray(0, 8));
  });
});
