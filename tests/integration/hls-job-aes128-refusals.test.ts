/**
 * SPEC-0017:IT-04, IT-05 — Recusas no flavor local e comportamento mantido no flavor public.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import { observeAndResolve, startDownload, startJob, waitForJob } from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';

let bg: BackgroundHarness;
let server: PlaylistServer | undefined;

beforeEach(() => {
  bg = startBackground();
  simulateOffscreen(bg, { mode: 'real' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
});

describe('recusas de download HLS', () => {
  it('SPEC-0017:IT-04 no flavor local, playlists fora da allowlist resultam em ENCRYPTED e o servidor não recebe requisição de segmentos', async () => {
    let segmentRequested = false;

    server = await startPlaylistServer({
      '/hls/sample-aes.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"',
          '#EXTINF:2.0,',
          'seg.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/keyformat-drm.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",KEYFORMAT="com.apple.streamingkeydelivery"',
          '#EXTINF:2.0,',
          'seg.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/faxs-cm.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-FAXS-CM:URI="faxs.bin"',
          '#EXTINF:2.0,',
          'seg.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/unknown-attr.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",UNKNOWN=1',
          '#EXTINF:2.0,',
          'seg.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/bad-uri.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-KEY:METHOD=AES-128,URI="javascript:alert(1)"',
          '#EXTINF:2.0,',
          'seg.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/seg.ts': (_req, res) => {
        segmentRequested = true;
        res.writeHead(200, { 'content-type': 'video/mp2t' }).end();
      },
    });

    const testPlaylists = [
      '/hls/sample-aes.m3u8',
      '/hls/keyformat-drm.m3u8',
      '/hls/faxs-cm.m3u8',
      '/hls/unknown-attr.m3u8',
      '/hls/bad-uri.m3u8',
    ];

    for (const path of testPlaylists) {
      segmentRequested = false;
      const { candidate } = await observeAndResolve(bg, `${server.origin}${path}`);
      const download = await startDownload(bg, candidate.id);

      expect(download.ok, `esperava recusa em ${path}`).toBe(false);
      expect((download as { ok: false; error: string }).error).toBe('ENCRYPTED');
      expect(segmentRequested, `segmento não deve ser requisitado em ${path}`).toBe(false);
    }
  });

  it('SPEC-0017:IT-04 chave com status 404 ou 15 bytes encerra com KEY_FAILED sem baixar segmentos', async () => {
    let segmentRequested = false;

    server = await startPlaylistServer({
      '/hls/404-key.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-KEY:METHOD=AES-128,URI="missing-key.bin"',
          '#EXTINF:2.0,',
          'seg.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/short-key.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-KEY:METHOD=AES-128,URI="short-key.bin"',
          '#EXTINF:2.0,',
          'seg.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/missing-key.bin': (_req, res) => {
        res.writeHead(404).end();
      },
      '/hls/short-key.bin': (_req, res) => {
        // 15 bytes (inválido: AES exige exatamente 16 bytes)
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 15 });
        res.end(new Uint8Array(15).fill(0x01));
      },
      '/hls/seg.ts': (_req, res) => {
        segmentRequested = true;
        res.writeHead(200).end();
      },
    });

    for (const playlist of ['/hls/404-key.m3u8', '/hls/short-key.m3u8']) {
      segmentRequested = false;
      const { candidate } = await observeAndResolve(bg, `${server.origin}${playlist}`);
      const { jobId } = await startJob(bg, candidate.id);
      const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

      expect(failed.error).toBe('KEY_FAILED');
      expect(segmentRequested).toBe(false);
    }
  });

  it('SPEC-0017:IT-05 (guarda: passa antes da mudança) flavor public sem política trata AES-128 como encrypted e recusa download', async () => {
    let keyRequested = false;
    let mediaRequested = false;

    server = await startPlaylistServer({
      '/hls/media.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:2',
          '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
          '#EXTINF:2.0,',
          'seg0.ts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/key.bin': (_req, res) => {
        keyRequested = true;
        res.writeHead(200).end();
      },
      '/hls/seg0.ts': (_req, res) => {
        mediaRequested = true;
        res.writeHead(200).end();
      },
    });

    const url = `${server.origin}/hls/media.m3u8`;
    const { candidate } = await observeAndResolve(bg, url);

    // Sem a política (comportamento público atual), o candidato é classificado como encrypted
    expect(candidate.hls?.encrypted).toBe(true);

    const download = await startDownload(bg, candidate.id);
    expect(download).toEqual({ ok: false, error: 'ENCRYPTED' });

    // Nem chave nem mídia foram buscadas
    expect(keyRequested).toBe(false);
    expect(mediaRequested).toBe(false);
  });
});
