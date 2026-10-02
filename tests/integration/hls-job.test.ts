/**
 * Contrato usado (SPEC-0012:IT-02) — background REAL + fakeBrowser + offscreen simulado + servidor HTTP local REAL:
 *  - mensagens (a própria extensão):
 *      {type:'download', candidateId, variantIndex?} (candidato HLS já resolvido) -> {ok:true, jobId}
 *        | {ok:false, error:'JOB_ALREADY_RUNNING' | 'TOO_MANY_JOBS' | ...};
 *      {type:'job', jobId} -> {ok:true, job: JobState} | {ok:false, error:'JOB_NOT_FOUND'};
 *      {type:'cancel', jobId} -> {ok:true} | {ok:false, error:'JOB_NOT_FOUND'};
 *  - o download re-busca a playlist da variante escolhida e manda o `start` ao offscreen (protocolo em
 *    tests/integration/support/offscreen.ts); o documento offscreen é criado sob demanda
 *    (`offscreen.createDocument({ url: '…offscreen.html', reasons: ['BLOBS'], justification })`) e fechado
 *    quando o último job termina;
 *  - ao receber `ready{blobUrl}` o background chama `downloads.download({ url: blobUrl, filename })`, com
 *    filename = toFilename({ title, label, mediaUrl }) (termina em ` - <rótulo>.mp4`); o job vai a `saving`
 *    (downloadId) e, em `downloads.onChanged` complete, a `done`; interrupted ou rejeição -> error
 *    'DOWNLOAD_FAILED'. Ao terminar (done/error) a blob URL é revogada: mensagem {target:'offscreen',
 *    type:'revoke', blobUrl};
 *  - no máximo 2 jobs simultâneos e 1 por candidato (qualquer variante);
 *  - o estado do job vive em storage.session: `bg.restart()` (service worker suspenso) preserva o job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import {
  captureDownloads,
  clipRoutes,
  isSegmentPath,
  jobOf,
  observeAndResolve,
  startDownload,
  startJob,
  waitForJob,
} from './support/hls-job';
import { startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import { CLIP_DURATION_SEC, concat, fmp4Init, fmp4Segments } from '../unit/support/hls-clip';
import { inspectMp4 } from '../unit/support/mp4';

let bg: BackgroundHarness;
let server: PlaylistServer;
let offscreen: SimulatedOffscreen;

const urlOf = (path: string): string => `${server.origin}/hls/clip/${path}`;

async function start(routes = clipRoutes(), mode: 'real' | 'manual' = 'real'): Promise<void> {
  server = await startPlaylistServer(routes);
  offscreen = simulateOffscreen(bg, { mode });
}

beforeEach(() => {
  bg = startBackground();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

describe('download HLS: do clique ao arquivo entregue ao chrome.downloads', () => {
  it('SPEC-0012:IT-02 download cria o job; job mostra o estado até done; downloads.download recebe a blob URL e o nome', async () => {
    await start();
    const saved = captureDownloads(bg, 77);
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));

    const started = await startDownload(bg, candidate.id);

    expect(started).toEqual({ ok: true, jobId: expect.any(String) as string });
    const { jobId } = started as { jobId: string };
    expect(await jobOf(bg, jobId)).toMatchObject({
      jobId,
      candidateId: candidate.id,
      variantIndex: 0,
    });
    const saving = await waitForJob(bg, jobId, (j) => j.state === 'saving');
    expect(saving).toMatchObject({
      segmentsDone: 3,
      segmentsTotal: 3,
      percent: 100,
      downloadId: 77,
    });
    expect(saving.bytesDone).toBeGreaterThan(100_000);
    expect(saving.filename).toMatch(/ - 360p\.mp4$/);
    expect(bg.download).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.url).toMatch(/^blob:/);
    expect(saved[0]?.filename).toBe(saving.filename);

    await bg.downloadEvents.complete(77);

    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');
    expect(done).toMatchObject({ downloadId: 77, percent: 100, filename: saving.filename });
    expect(done.error).toBeUndefined();
  });

  it('SPEC-0012:IT-02 o arquivo entregue ao chrome.downloads é um MP4 válido da variante baixada (ftyp/moov/mdat, ~6 s, 640x360)', async () => {
    await start();
    const saved = captureDownloads(bg);
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    const info = inspectMp4(saved[0]?.bytes ?? new Uint8Array());
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'mdat']));
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([640, 360]);
  });

  it('SPEC-0012:IT-02 variantIndex 1 baixa só a variante escolhida (180p): rótulo no nome e nenhum segmento da outra', async () => {
    await start();
    const saved = captureDownloads(bg);
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id, 1);
    const saving = await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(saving.variantIndex).toBe(1);
    expect(saving.filename).toMatch(/ - 180p\.mp4$/);
    const video = inspectMp4(saved[0]?.bytes ?? new Uint8Array()).tracks.find(
      (t) => t.handler === 'vide',
    );
    expect([video?.width, video?.height]).toEqual([320, 180]);
    const paths = server.requests.map((r) => r.split('?')[0] ?? '');
    expect(paths.filter(isSegmentPath).every((p) => p.includes('v180-'))).toBe(true);
    expect(paths.filter(isSegmentPath)).toHaveLength(3);
    expect(paths.some((p) => p.includes('v360-'))).toBe(false);
  });

  it('SPEC-0012:IT-02 HLS fMP4 (EXT-X-MAP): o arquivo é o init seguido dos segmentos', async () => {
    await start();
    const saved = captureDownloads(bg);
    const { candidate } = await observeAndResolve(bg, urlOf('fmp4/media.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const saving = await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(saved[0]?.bytes).toEqual(concat([fmp4Init(), ...fmp4Segments()]));
    expect(saving.segmentsTotal).toBe(3);
  });

  it('SPEC-0012:IT-02 o offscreen é criado sob demanda (razão BLOBS) uma vez e fechado ao fim do último job; a blob URL é revogada', async () => {
    await start();
    const saved = captureDownloads(bg, 5);
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    expect(bg.offscreen.createDocument).not.toHaveBeenCalled();

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(bg.offscreen.createDocument).toHaveBeenCalledTimes(1);
    const options = bg.offscreen.createDocument.mock.calls[0]?.[0] as {
      url: string;
      reasons: string[];
      justification: string;
    };
    expect(options.url).toMatch(/offscreen\.html$/);
    expect(options.reasons).toEqual(['BLOBS']);
    expect(options.justification.length).toBeGreaterThan(0);
    expect(bg.offscreen.isOpen()).toBe(true);

    await bg.downloadEvents.complete(5);
    await waitForJob(bg, jobId, (j) => j.state === 'done');

    await vi.waitFor(() => {
      expect(bg.offscreen.isOpen()).toBe(false);
    });
    expect(bg.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(offscreen.revoked).toEqual([saved[0]?.url]);
  });

  it('SPEC-0012:IT-02 progresso: segmentsDone e percent crescem sem regredir; o estado sobrevive a bg.restart() e o job termina no novo service worker', async () => {
    await start(clipRoutes(), 'manual');
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    const [command] = offscreen.starts();
    expect(command).toMatchObject({ jobId, fmp4: false });
    expect(command?.urls).toEqual([0, 1, 2].map((i) => urlOf(`v360-${String(i)}.mpegts`)));
    expect(await jobOf(bg, jobId)).toMatchObject({
      state: expect.stringMatching(/^(queued|running)$/) as string,
    });

    await offscreen.emit(jobId, {
      type: 'progress',
      segmentsDone: 1,
      segmentsTotal: 3,
      bytesDone: 1000,
    });
    const one = await jobOf(bg, jobId);
    await offscreen.emit(jobId, {
      type: 'progress',
      segmentsDone: 2,
      segmentsTotal: 3,
      bytesDone: 2200,
    });
    const two = await jobOf(bg, jobId);

    expect(one).toMatchObject({
      state: 'running',
      segmentsDone: 1,
      segmentsTotal: 3,
      bytesDone: 1000,
    });
    expect(two).toMatchObject({
      state: 'running',
      segmentsDone: 2,
      segmentsTotal: 3,
      bytesDone: 2200,
    });
    expect(Math.abs(one.percent - 33)).toBeLessThanOrEqual(1);
    expect(two.percent).toBeGreaterThan(one.percent);

    bg.restart();

    expect(await jobOf(bg, jobId)).toEqual(two);

    await offscreen.emit(jobId, { type: 'assembling' });
    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'assembling' });
    await offscreen.emit(jobId, {
      type: 'ready',
      blobUrl: 'blob:chrome-extension://x/abc',
      bytes: 123,
    });

    await vi.waitFor(() => {
      expect(bg.download).toHaveBeenCalledTimes(1);
    });
    expect(bg.download).toHaveBeenCalledWith({
      url: 'blob:chrome-extension://x/abc',
      filename: expect.stringMatching(/ - 360p\.mp4$/) as string,
    });
    await bg.downloadEvents.complete(1);
    expect(await waitForJob(bg, jobId, (j) => j.state === 'done')).toMatchObject({
      downloadId: 1,
      percent: 100,
    });
    expect(offscreen.revoked).toContain('blob:chrome-extension://x/abc');
  });

  it('SPEC-0012:IT-02 um evento de progresso atrasado (menor) não faz o job regredir', async () => {
    await start(clipRoutes(), 'manual');
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);

    await offscreen.emit(jobId, {
      type: 'progress',
      segmentsDone: 2,
      segmentsTotal: 3,
      bytesDone: 2000,
    });
    const before = await jobOf(bg, jobId);
    await offscreen.emit(jobId, {
      type: 'progress',
      segmentsDone: 1,
      segmentsTotal: 3,
      bytesDone: 900,
    });
    const after = await jobOf(bg, jobId);

    expect(after.segmentsDone).toBe(2);
    expect(after.percent).toBeGreaterThanOrEqual(before.percent);
  });
});

describe('download HLS: limites e erros', () => {
  it('SPEC-0012:IT-02 segundo job do mesmo candidato -> JOB_ALREADY_RUNNING (inclusive em outra variante); depois de cancelar, pode de novo', async () => {
    await start(clipRoutes(), 'manual');
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    const first = await startJob(bg, candidate.id, 0);
    expect(typeof first.jobId).toBe('string');

    expect(await startDownload(bg, candidate.id, 0)).toEqual({
      ok: false,
      error: 'JOB_ALREADY_RUNNING',
    });
    expect(await startDownload(bg, candidate.id, 1)).toEqual({
      ok: false,
      error: 'JOB_ALREADY_RUNNING',
    });
    expect(offscreen.starts()).toHaveLength(1);

    expect(await bg.send({ type: 'cancel', jobId: first.jobId })).toEqual({ ok: true });
    expect(await startDownload(bg, candidate.id, 1)).toMatchObject({ ok: true });
  });

  it('SPEC-0012:IT-02 três jobs simultâneos: o terceiro -> TOO_MANY_JOBS (limite 2); ao terminar um, entra outro', async () => {
    await start(clipRoutes(), 'manual');
    const tab = await bg.newTab();
    const a = await observeAndResolve(bg, urlOf('v360.m3u8'), tab);
    const b = await observeAndResolve(bg, urlOf('v180.m3u8'), tab);
    const c = await observeAndResolve(bg, urlOf('fmp4/media.m3u8'), tab);

    const jobA = await startJob(bg, a.candidate.id);
    const jobB = await startDownload(bg, b.candidate.id);
    const third = await startDownload(bg, c.candidate.id);

    expect(typeof jobA.jobId).toBe('string');
    expect(jobB).toMatchObject({ ok: true });
    expect(third).toEqual({ ok: false, error: 'TOO_MANY_JOBS' });
    expect(offscreen.starts()).toHaveLength(2);

    await bg.send({ type: 'cancel', jobId: jobA.jobId });

    expect(await startDownload(bg, c.candidate.id)).toMatchObject({ ok: true });
  });

  it('SPEC-0012:IT-02 segmento que falha definitivamente (404) -> job error FETCH_FAILED, 4 tentativas, nenhum arquivo e offscreen fechado', async () => {
    const routes = clipRoutes();
    routes['/hls/clip/v360-1.mpegts'] = (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('nao existe');
    };
    await start(routes);
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('FETCH_FAILED');
    expect(failed.filename).toBeUndefined();
    expect(bg.download).not.toHaveBeenCalled();
    expect(offscreen.createdBlobUrls).toEqual([]);
    expect(server.requests.filter((r) => r.includes('v360-1.mpegts'))).toHaveLength(4);
    await vi.waitFor(() => {
      expect(bg.offscreen.isOpen()).toBe(false);
    });
  });

  it('SPEC-0012:IT-02 o offscreen reporta falha de montagem (UNSUPPORTED_CODEC): job error com o mesmo código, sem chamar downloads.download', async () => {
    await start(clipRoutes(), 'manual');
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);

    await offscreen.emit(jobId, { type: 'assembling' });
    await offscreen.emit(jobId, { type: 'failed', error: 'UNSUPPORTED_CODEC' });

    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'error', error: 'UNSUPPORTED_CODEC' });
    expect(bg.download).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(bg.offscreen.isOpen()).toBe(false);
    });
  });

  it('SPEC-0012:IT-02 downloads.download rejeitando -> job error DOWNLOAD_FAILED e a blob URL é revogada', async () => {
    await start();
    bg.download.mockRejectedValue(new Error('Invalid filename'));
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('DOWNLOAD_FAILED');
    await vi.waitFor(() => {
      expect(offscreen.revoked).toEqual(offscreen.createdBlobUrls);
    });
    expect(offscreen.createdBlobUrls).toHaveLength(1);
  });

  it('SPEC-0012:IT-02 download interrompido pelo navegador (onChanged interrupted) -> error DOWNLOAD_FAILED e blob revogada', async () => {
    await start();
    bg.download.mockResolvedValue(9);
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    await bg.downloadEvents.interrupt(9);

    expect((await waitForJob(bg, jobId, (j) => j.state === 'error')).error).toBe('DOWNLOAD_FAILED');
    await vi.waitFor(() => {
      expect(offscreen.revoked).toEqual(offscreen.createdBlobUrls);
    });
    expect(offscreen.createdBlobUrls).toHaveLength(1);
  });

  it('SPEC-0012:IT-02 job e cancel de um jobId desconhecido -> JOB_NOT_FOUND', async () => {
    await start();

    expect(await bg.send({ type: 'job', jobId: 'nao-existe' })).toEqual({
      ok: false,
      error: 'JOB_NOT_FOUND',
    });
    expect(await bg.send({ type: 'cancel', jobId: 'nao-existe' })).toEqual({
      ok: false,
      error: 'JOB_NOT_FOUND',
    });
  });

  it('SPEC-0012:IT-02 mensagens de job/cancel/download que não vêm da própria extensão são rejeitadas', async () => {
    await start(clipRoutes(), 'manual');
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);

    for (const message of [
      { type: 'job', jobId },
      { type: 'cancel', jobId },
      { type: 'download', candidateId: candidate.id },
    ]) {
      expect(await bg.send(message, 'outra-extensao')).toEqual({
        ok: false,
        error: 'INVALID_MESSAGE',
      });
    }
    expect(await jobOf(bg, jobId)).toMatchObject({
      state: expect.stringMatching(/^(queued|running)$/) as string,
    });
  });

  it('SPEC-0012:IT-02 um evento do offscreen que não vem da própria extensão não altera o job', async () => {
    await start(clipRoutes(), 'manual');
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);

    await bg.send(
      {
        target: 'background',
        jobId,
        event: { type: 'ready', blobUrl: 'blob:evil', bytes: 1 },
      },
      'outra-extensao',
    );

    expect(bg.download).not.toHaveBeenCalled();
    expect(await jobOf(bg, jobId)).toMatchObject({
      state: expect.stringMatching(/^(queued|running)$/) as string,
    });
  });

  it('SPEC-0012:IT-02 (guarda: passa antes da mudança) download de candidato HLS de variante inexistente (variantIndex fora da lista) não cria job', async () => {
    await start(clipRoutes(), 'manual');
    const { candidate } = await observeAndResolve(bg, urlOf('master.m3u8'));

    const response = await startDownload(bg, candidate.id, 7);

    expect(response.ok).toBe(false);
    expect(offscreen.starts()).toEqual([]);
    expect(bg.download).not.toHaveBeenCalled();
  });
});
