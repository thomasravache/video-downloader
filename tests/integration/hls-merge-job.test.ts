/**
 * Contrato usado (SPEC-0014 §6) — background REAL + fakeBrowser + offscreen REAL (runOffscreenJob) + servidor
 * HTTP local REAL com `Range`; fixtures REAIS de e2e/fixtures/hls/split-av (vídeo e áudio em fMP4 de arquivo
 * único, playlists com BYTERANGE, master com `EXT-X-MEDIA TYPE=AUDIO` + `AUDIO="a1"`):
 *  - `download` de uma variante com grupo de áudio: o `start` do offscreen leva `audio` {urls, initUrl, ranges,
 *    initRange}; o job termina `done` e o Blob salvo é um MP4 com as duas trilhas; `segmentsTotal`/`segmentsDone`
 *    somam vídeo + áudio; TODA requisição de mídia leva o `Range` certo;
 *  - `download.audioIndex` escolhe a faixa (padrão: DEFAULT=YES do grupo, senão a primeira);
 *  - sem `AUDIO=` na variante o comportamento é o de hoje (só vídeo, sem `audio` no `start`);
 *  - soma das faixas de vídeo + áudio acima do limite combinado -> job `error` TOO_LARGE sem NENHUMA requisição
 *    de mídia (o limite final sai da medição da fase 1, no máximo 2 GiB: os casos usam soma > 2 GiB com cada
 *    trilha abaixo do limite antigo de 1,5 GiB);
 *  - `sinf`/`schm` no init de áudio OU de vídeo -> job `error` ENCRYPTED e nada é salvo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { captureDownloads, observeAndResolve, startJob, waitForJob } from './support/hls-job';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import { body, rangeHandler, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import {
  AUDIO_MEDIA,
  STREAM,
  hugePlaylist,
  masterOf,
  mediaLog,
  singleFile,
  splitRoutes,
  splitTrack,
  startSplitDownload,
} from './support/split-av';
import { inspectMp4 } from '../unit/support/mp4';
import { concat } from '../unit/support/hls-clip';
import { withEncryptionBox, withEncryptionBoxIn } from '../unit/support/mp4-build';

const video = splitTrack('video');
const audio = splitTrack('audio');
const sourceSamples = (t: { init: Uint8Array; segments: Uint8Array[] }): number =>
  inspectMp4(concat([t.init, ...t.segments])).tracks[0]?.sampleCount ?? -1;

let bg: BackgroundHarness;
let server: PlaylistServer;
let offscreen: SimulatedOffscreen;
const o = (path: string): string => `${server.origin}${path}`;

beforeEach(() => {
  bg = startBackground();
});
afterEach(async () => {
  await server.close();
});

async function serve(routes: Parameters<typeof startPlaylistServer>[0]): Promise<void> {
  server = await startPlaylistServer(routes);
  offscreen = simulateOffscreen(bg);
}

describe('download com áudio separado: um único MP4 com as duas trilhas', () => {
  it('SPEC-0014:IT-02 job done: o Blob tem 2 trilhas (vide 320x180 + soun) com as amostras das fontes e o progresso soma vídeo e áudio', async () => {
    await serve(splitRoutes());
    const saved = captureDownloads(bg, 77);
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const saving = await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(done.error).toBeUndefined();
    const total = video.segments.length + audio.segments.length;
    expect(saving).toMatchObject({ segmentsDone: total, segmentsTotal: total, percent: 100 });
    expect(saved).toHaveLength(1);
    const info = inspectMp4(saved[0]?.bytes ?? new Uint8Array());
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    expect(info.tracks.find((t) => t.handler === 'vide')).toMatchObject({
      width: 320,
      height: 180,
    });
    expect(info.tracks.find((t) => t.handler === 'vide')?.sampleCount).toBe(sourceSamples(video));
    expect(info.tracks.find((t) => t.handler === 'soun')?.sampleCount).toBe(sourceSamples(audio));
  });

  it('SPEC-0014:IT-02 o start leva video e audio com ranges; TODA requisição de mídia leva o Range certo, no arquivo certo', async () => {
    await serve(splitRoutes());
    captureDownloads(bg, 5);
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    const [start] = offscreen.starts();
    expect(start?.urls).toEqual(video.segments.map(() => o('/av/video.mp4')));
    expect(start?.audio?.urls).toEqual(audio.segments.map(() => o('/av/audio.mp4')));
    expect(start?.audio?.initUrl).toBe(o('/av/audio.mp4'));
    expect(start?.audio?.ranges).toHaveLength(audio.segments.length);
    const media = mediaLog(server);
    expect(media.every((r) => r.range !== undefined)).toBe(true);
    const seen = media.map((r) => `${new URL(r.url, 'http://x').pathname} ${r.range ?? ''}`).sort();
    const expected = [
      ...video.ranges.map((r) => `/av/video.mp4 ${r}`),
      ...audio.ranges.map((r) => `/av/audio.mp4 ${r}`),
    ].sort();
    expect(seen).toEqual(expected);
  });

  it('SPEC-0014:IT-02 audioIndex escolhe a faixa: a 2ª (pt, de outro arquivo) é a baixada e a padrão não é requisitada', async () => {
    const master = masterOf(
      AUDIO_MEDIA('a1', 'English', 'audio.m3u8', { isDefault: true }),
      AUDIO_MEDIA('a1', 'Português', 'audio-pt.m3u8', { language: 'pt' }),
      STREAM('video.m3u8', 'a1'),
    );
    await serve(
      splitRoutes('/av', {
        master,
        extra: {
          '/av/audio-pt.m3u8': body(audio.playlist.replaceAll('audio.mp4', 'audio-pt.mp4')),
          '/av/audio-pt.mp4': rangeHandler(audio.file),
        },
      }),
    );
    const saved = captureDownloads(bg, 9);
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const response = await startSplitDownload(bg, candidate.id, { variantIndex: 0, audioIndex: 1 });
    expect(response).toMatchObject({ ok: true });
    const jobId = (response as { jobId: string }).jobId;
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    const paths = mediaLog(server).map((r) => new URL(r.url, 'http://x').pathname);
    expect(paths).toContain('/av/audio-pt.mp4');
    expect(paths).not.toContain('/av/audio.mp4');
    expect(
      inspectMp4(saved[0]?.bytes ?? new Uint8Array())
        .tracks.map((t) => t.handler)
        .sort(),
    ).toEqual(['soun', 'vide']);
  });

  it('SPEC-0014:IT-02 (guarda) variante sem AUDIO=: só vídeo, o start não leva audio e o MP4 tem 1 trilha', async () => {
    await serve(
      splitRoutes('/av', {
        master: masterOf(
          AUDIO_MEDIA('a1', 'English', 'audio.m3u8', { isDefault: true }),
          STREAM('video.m3u8'),
        ),
      }),
    );
    const saved = captureDownloads(bg, 3);
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(offscreen.starts()[0]?.audio).toBeUndefined();
    expect(inspectMp4(saved[0]?.bytes ?? new Uint8Array()).tracks.map((t) => t.handler)).toEqual([
      'vide',
    ]);
    expect(mediaLog(server).some((r) => r.url.includes('audio.mp4'))).toBe(false);
  });
});

describe('limite combinado da junção', () => {
  const GIB = 1024 * 1024 * 1024;

  it('SPEC-0014:IT-06 faixas de vídeo (1 GiB) + áudio (1,2 GiB), cada uma abaixo de 1,5 GiB mas somando mais que o limite: TOO_LARGE sem nenhuma requisição de mídia', async () => {
    await serve(
      splitRoutes('/av', {
        videoPlaylist: hugePlaylist('video.mp4', [GIB]),
        audioPlaylist: hugePlaylist('audio.mp4', [Math.round(1.2 * GIB)]),
      }),
    );
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('TOO_LARGE');
    expect(mediaLog(server)).toEqual([]);
    expect(bg.download).not.toHaveBeenCalled();
    await offscreen.idle();
    expect(offscreen.createdBlobUrls).toEqual([]);
  });

  it('SPEC-0014:IT-06 vários trechos de vídeo e de áudio: a soma de todos (init incluído) é a que vale', async () => {
    await serve(
      splitRoutes('/av', {
        videoPlaylist: hugePlaylist('video.mp4', [GIB / 2, GIB / 2, GIB / 4]),
        audioPlaylist: hugePlaylist('audio.mp4', [GIB / 2, GIB / 2, GIB / 4, GIB / 4]),
      }),
    );
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('TOO_LARGE');
    expect(mediaLog(server)).toEqual([]);
  });
});

describe('criptografia no init de qualquer trilha', () => {
  async function run(
    videoBuilt: ReturnType<typeof singleFile>,
    audioBuilt: ReturnType<typeof singleFile>,
  ) {
    await serve(
      splitRoutes('/av', {
        videoPlaylist: videoBuilt.playlist,
        audioPlaylist: audioBuilt.playlist,
        videoFile: videoBuilt.file,
        audioFile: audioBuilt.file,
      }),
    );
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    return waitForJob(bg, jobId, (j) => j.state === 'error');
  }

  it('SPEC-0014:IT-07 init de ÁUDIO com sinf/schm (enca): job error ENCRYPTED e nada é salvo', async () => {
    const failed = await run(
      singleFile(video.init, video.segments, 'video.mp4'),
      singleFile(withEncryptionBoxIn(audio.init, 'mp4a', 'enca'), audio.segments, 'audio.mp4'),
    );

    expect(failed.error).toBe('ENCRYPTED');
    expect(bg.download).not.toHaveBeenCalled();
    await offscreen.idle();
    expect(offscreen.createdBlobUrls).toEqual([]);
  });

  it('SPEC-0014:IT-07 init de VÍDEO com sinf/schm (encv): job error ENCRYPTED e nada é salvo', async () => {
    const failed = await run(
      singleFile(withEncryptionBox(video.init), video.segments, 'video.mp4'),
      singleFile(audio.init, audio.segments, 'audio.mp4'),
    );

    expect(failed.error).toBe('ENCRYPTED');
    expect(bg.download).not.toHaveBeenCalled();
    await offscreen.idle();
    expect(offscreen.createdBlobUrls).toEqual([]);
  });

  it('SPEC-0014:IT-07 (guarda) os mesmos arquivos remontados sem criptografia viram um MP4 com 2 trilhas: a recusa vem do init', async () => {
    const v = singleFile(video.init, video.segments, 'video.mp4');
    const a = singleFile(audio.init, audio.segments, 'audio.mp4');
    await serve(
      splitRoutes('/av', {
        videoPlaylist: v.playlist,
        audioPlaylist: a.playlist,
        videoFile: v.file,
        audioFile: a.file,
      }),
    );
    const saved = captureDownloads(bg, 4);
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const state = await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(state.error).toBeUndefined();
    expect(
      inspectMp4(saved[0]?.bytes ?? new Uint8Array())
        .tracks.map((t) => t.handler)
        .sort(),
    ).toEqual(['soun', 'vide']);
  });
});
