/**
 * SPEC-0017:IT-07 — Recuperação da chave protegida por CDN via escada de contexto (SPEC-0016).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import type { DnrHarness } from './support/dnr';
import { simulateOffscreen } from './support/offscreen';
import { PLAYER, observeFrom, resolve } from './support/context';
import { captureDownloads, fileHandler, startJob, waitForJob } from './support/hls-job';
import { body, requireContext, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import { tsSegments } from '../unit/support/hls-clip';
import { encryptAes128Cbc, sequenceToIv } from '../unit/support/aes128-crypto';

let bg: BackgroundHarness & { dnr: DnrHarness };
let server: PlaylistServer | undefined;

const KEY_BYTES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);

beforeEach(() => {
  bg = startBackground({ dnr: true });
  simulateOffscreen(bg, { mode: 'real' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
});

describe('SPEC-0017:IT-07 contexto de requisição na busca da chave', () => {
  it('SPEC-0017:IT-07 host de chave que responde 403 sem Origin/Referer do iniciador é recuperado pela escada e conclui done', async () => {
    const rawSegments = tsSegments('v180');
    const seg0 = rawSegments[0];
    if (!seg0) throw new Error('missing segment');
    const encSeg0 = encryptAes128Cbc(KEY_BYTES, sequenceToIv(0), seg0);

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
      // A chave exige Origin/Referer do player (retorna 403 sem eles)
      '/hls/key.bin': requireContext(PLAYER, fileHandler(KEY_BYTES, 'application/octet-stream')),
      '/hls/seg0.ts': fileHandler(encSeg0, 'video/mp2t'),
    });

    const url = `${server.origin}/hls/media.m3u8`;
    captureDownloads(bg);

    // O candidato observado na rede traz o iniciador (PLAYER)
    const candidate = await observeFrom(bg, url, PLAYER);
    const resolved = await resolve(bg, candidate.id);
    expect(resolved.ok).toBe(true);

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(done.state).toBe('done');
  });
});
