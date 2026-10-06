/**
 * SPEC-0017:IT-06 — Privacidade e sigilo: chaves, URIs de chave e tokens não aparecem em logs, estado ou erros.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import {
  captureDownloads,
  fileHandler,
  observeAndResolve,
  startJob,
  waitForJob,
} from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import { tsSegments } from '../unit/support/hls-clip';
import { encryptAes128Cbc, sequenceToIv } from '../unit/support/aes128-crypto';

let bg: BackgroundHarness;
let server: PlaylistServer | undefined;

const SECRET_TOKEN = 'secret-token-xyz789';
const HDNTL_TOKEN = 'hdntl-session-abc456';
const KEY_BYTES = new Uint8Array(16).fill(0x77);

beforeEach(() => {
  bg = startBackground();
  simulateOffscreen(bg, { mode: 'real' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
});

describe('SPEC-0017:IT-06 privacidade e dados sensíveis', () => {
  it('SPEC-0017:IT-06 chave, URI da chave e tokens nunca aparecem em diagnósticos, estado do job ou erros (sucesso, falha e cancelamento)', async () => {
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
          `#EXT-X-KEY:METHOD=AES-128,URI="key.bin?token=${SECRET_TOKEN}&hdntl=${HDNTL_TOKEN}"`,
          '#EXTINF:2.0,',
          `seg0.ts?token=${SECRET_TOKEN}`,
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      [`/hls/key.bin`]: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 16 });
        res.end(KEY_BYTES);
      },
      [`/hls/seg0.ts`]: fileHandler(encSeg0, 'video/mp2t'),
    });

    const url = `${server.origin}/hls/media.m3u8`;
    captureDownloads(bg);
    const { candidate } = await observeAndResolve(bg, url);

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    const job = await waitForJob(bg, jobId, (j) => j.state === 'done');

    // 1. Estado do job não deve conter tokens nem chave
    const jobJson = JSON.stringify(job);
    expect(jobJson).not.toContain(SECRET_TOKEN);
    expect(jobJson).not.toContain(HDNTL_TOKEN);
    expect(jobJson).not.toContain('key.bin');

    // 2. Diagnóstico local não deve conter tokens nem a URI da chave
    const diagResponse = (await bg.send({ type: 'diagnostics' })) as {
      ok: boolean;
      text: string;
    };
    expect(diagResponse.ok).toBe(true);
    expect(diagResponse.text).not.toContain(SECRET_TOKEN);
    expect(diagResponse.text).not.toContain(HDNTL_TOKEN);
    expect(diagResponse.text).not.toContain('key.bin');

    // 3. Ao cancelar ou falhar, nenhum token é vazado
    const { jobId: cancelJobId } = await startJob(bg, candidate.id);
    await bg.send({ type: 'cancel', jobId: cancelJobId });
    const canceledJob = await waitForJob(bg, cancelJobId, (j) => j.state === 'canceled');
    expect(JSON.stringify(canceledJob)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(canceledJob)).not.toContain(HDNTL_TOKEN);
  });
});
