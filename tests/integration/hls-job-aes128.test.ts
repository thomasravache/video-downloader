/**
 * SPEC-0017:IT-01, IT-02, IT-03 — Downloads HLS com criptografia AES-128 (TS, fMP4 com byte range e rotação).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tsSegments } from '../unit/support/hls-clip';
import { inspectMp4 } from '../unit/support/mp4';
import { encryptAes128Cbc, sequenceToIv } from '../unit/support/aes128-crypto';
import { singleFileFixture } from './support/byte-range';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import {
  captureDownloads,
  fileHandler,
  observeAndResolve,
  startJob,
  waitForJob,
} from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';

let bg: BackgroundHarness;
let server: PlaylistServer | undefined;
let _offscreen: SimulatedOffscreen;

const KEY_BYTES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);
const KEY_B_BYTES = new Uint8Array(16).fill(0x55);
const IV_A = new Uint8Array(16).fill(0x11);
const IV_B = new Uint8Array(16).fill(0x22);

beforeEach(() => {
  bg = startBackground();
  _offscreen = simulateOffscreen(bg, { mode: 'real' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
});

describe('download HLS com criptografia AES-128', () => {
  it('SPEC-0017:IT-01 download de playlist TS com AES-128 busca chave antes dos segmentos e entrega MP4 válido', async () => {
    const rawSegments = tsSegments('v180');
    const seg0 = rawSegments[0];
    const seg1 = rawSegments[1];
    if (!seg0 || !seg1) throw new Error('missing segments');
    const encSeg0 = encryptAes128Cbc(KEY_BYTES, sequenceToIv(0), seg0);
    const encSeg1 = encryptAes128Cbc(KEY_BYTES, sequenceToIv(1), seg1);

    const requestOrder: string[] = [];

    server = await startPlaylistServer({
      '/hls/master.m3u8': body(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180\nmedia.m3u8\n',
      ),
      '/hls/media.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:2',
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
          '#EXTINF:2.0,',
          'seg0.mpegts',
          '#EXTINF:2.0,',
          'seg1.mpegts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/key.bin': (_req, res) => {
        requestOrder.push('key');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 16 });
        res.end(KEY_BYTES);
      },
      '/hls/seg0.mpegts': (_req, res) => {
        requestOrder.push('seg0');
        fileHandler(encSeg0, 'video/mp2t')(_req, res);
      },
      '/hls/seg1.mpegts': (_req, res) => {
        requestOrder.push('seg1');
        fileHandler(encSeg1, 'video/mp2t')(_req, res);
      },
    });

    const masterUrl = `${server.origin}/hls/master.m3u8`;
    const captured = captureDownloads(bg);
    const { candidate } = await observeAndResolve(bg, masterUrl);

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(done.state).toBe('done');
    // A chave deve ter sido pedida antes do primeiro segmento de mídia
    const keyIndex = requestOrder.indexOf('key');
    const seg0Index = requestOrder.indexOf('seg0');
    expect(keyIndex).toBeGreaterThanOrEqual(0);
    expect(seg0Index).toBeGreaterThan(keyIndex);

    // O MP4 gerado deve ser válido
    expect(captured).toHaveLength(1);
    const firstDownload = captured[0];
    if (!firstDownload) throw new Error('no captured download');
    const mp4 = inspectMp4(firstDownload.bytes);
    expect(mp4.tracks.length).toBeGreaterThanOrEqual(1);
  });

  it('SPEC-0017:IT-02 download de fMP4 de arquivo único com byte range e AES-128 conclui done', async () => {
    const fixture = singleFileFixture();
    // No caso AES-128 com byte range, o conteúdo cifrado é servido no intervalo
    server = await startPlaylistServer({
      '/hls/media.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          '#EXT-X-TARGETDURATION:2',
          '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
          fixture.playlist('media.mp4'),
        ].join('\n'),
      ),
      '/hls/key.bin': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 16 });
        res.end(KEY_BYTES);
      },
      '/hls/media.mp4': fileHandler(fixture.file, 'video/mp4'),
    });

    const url = `${server.origin}/hls/media.m3u8`;
    captureDownloads(bg);
    const { candidate } = await observeAndResolve(bg, url);

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(done.state).toBe('done');
  });

  it('SPEC-0017:IT-03 download com rotação de chaves e IVs explícitos conclui done', async () => {
    const rawSegments = tsSegments('v180');
    const seg0 = rawSegments[0];
    const seg1 = rawSegments[1];
    if (!seg0 || !seg1) throw new Error('missing segments');
    const encSeg0 = encryptAes128Cbc(KEY_BYTES, IV_A, seg0);
    const encSeg1 = encryptAes128Cbc(KEY_B_BYTES, IV_B, seg1);

    server = await startPlaylistServer({
      '/hls/rotation.m3u8': body(
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:2',
          '#EXT-X-KEY:METHOD=AES-128,URI="keyA.bin",IV=0x11111111111111111111111111111111',
          '#EXTINF:2.0,',
          'seg0.mpegts',
          '#EXT-X-KEY:METHOD=AES-128,URI="keyB.bin",IV=0x22222222222222222222222222222222',
          '#EXTINF:2.0,',
          'seg1.mpegts',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      ),
      '/hls/keyA.bin': fileHandler(KEY_BYTES, 'application/octet-stream'),
      '/hls/keyB.bin': fileHandler(KEY_B_BYTES, 'application/octet-stream'),
      '/hls/seg0.mpegts': fileHandler(encSeg0, 'video/mp2t'),
      '/hls/seg1.mpegts': fileHandler(encSeg1, 'video/mp2t'),
    });

    const url = `${server.origin}/hls/rotation.m3u8`;
    captureDownloads(bg);
    const { candidate } = await observeAndResolve(bg, url);

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(done.state).toBe('done');
  });
});
