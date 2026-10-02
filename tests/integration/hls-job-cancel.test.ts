/**
 * Contrato usado (SPEC-0012:IT-04) — background REAL + fakeBrowser + offscreen simulado + servidor HTTP local REAL:
 *  - {type:'cancel', jobId} -> {ok:true}; o job vai a 'canceled' (terminal, congelado) e o background manda
 *    {target:'offscreen', type:'cancel', jobId}; o offscreen aborta os fetches em andamento (< 1 s) e não
 *    inicia nenhum novo;
 *  - se já existe blob URL (job em 'saving'), ela é revogada ({target:'offscreen', type:'revoke', blobUrl});
 *    evento 'ready' que chegue depois do cancelamento não baixa nada e também revoga a blob URL;
 *  - sem outros jobs, o documento offscreen é fechado;
 *  - o servidor aqui SEGURA a resposta dos segmentos 1.. (só o segmento 0 responde) e conta as conexões.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import {
  clipRoutes,
  fileHandler,
  isSegmentPath,
  jobOf,
  observeAndResolve,
  startDownload,
  startJob,
  waitForJob,
} from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';

const SEGMENTS = 12;

let bg: BackgroundHarness;
let server: PlaylistServer;
let offscreen: SimulatedOffscreen;
const held = new Set<string>();

const o = (path: string): string => `${server.origin}${path}`;
const segmentRequests = (): string[] => server.requests.filter(isSegmentPath);

/** Cede o controle algumas vezes para que qualquer requisição pendente tivesse chance de sair. */
async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function playlist(): string {
  const items = Array.from(
    { length: SEGMENTS },
    (_, i) => `#EXTINF:2.0,\ng${String(i)}.mpegts`,
  ).join('\n');
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n${items}\n#EXT-X-ENDLIST\n`;
}

/** Segmento 0 responde; os demais ficam pendurados até o cliente fechar a conexão. */
const gated =
  (index: number): Handler =>
  (req, res) => {
    if (index === 0) {
      fileHandler(new Uint8Array(500).fill(2), 'video/mp2t')(req, res);
      return;
    }
    const id = `${String(index)}:${String(Math.random())}`;
    held.add(id);
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': '100000' });
    res.flushHeaders();
    res.on('close', () => {
      held.delete(id);
    });
  };

async function startGated(mode: 'real' | 'manual' = 'real'): Promise<void> {
  const routes: Record<string, Handler> = { '/r/long.m3u8': body(playlist()) };
  for (let i = 0; i < SEGMENTS; i++) {
    routes[`/r/g${String(i)}.mpegts`] = gated(i);
  }
  server = await startPlaylistServer({ ...routes, ...clipRoutes() });
  offscreen = simulateOffscreen(bg, { mode });
}

beforeEach(() => {
  bg = startBackground();
  held.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

describe('cancelamento de jobs de download HLS', () => {
  it('SPEC-0012:IT-04 cancelar durante o download interrompe as requisições em < 1 s e não inicia nenhuma nova', async () => {
    await startGated();
    const { candidate } = await observeAndResolve(bg, o('/r/long.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.segmentsDone >= 1);
    await vi.waitFor(() => {
      expect(held.size).toBe(4);
    });
    const before = await jobOf(bg, jobId);
    expect(before.state).toBe('running');

    const startedAt = performance.now();
    const response = await bg.send({ type: 'cancel', jobId });
    await vi.waitFor(
      () => {
        expect(held.size).toBe(0);
      },
      { timeout: 1000, interval: 5 },
    );
    const elapsed = performance.now() - startedAt;

    expect(response).toEqual({ ok: true });
    expect(elapsed).toBeLessThan(1000);
    const requestedAtStop = segmentRequests().length;
    await settle();
    expect(segmentRequests()).toHaveLength(requestedAtStop);
    // Concorrência 4 + a que entrou quando o segmento 0 terminou; nunca o resto da playlist.
    expect(requestedAtStop).toBeLessThanOrEqual(5);
    expect(segmentRequests().some((r) => r.includes('g11.mpegts'))).toBe(false);
    expect(await jobOf(bg, jobId)).toMatchObject({
      state: 'canceled',
      segmentsDone: before.segmentsDone,
    });
    expect(offscreen.commands.some((c) => c.type === 'cancel' && c.jobId === jobId)).toBe(true);
    expect(bg.download).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(bg.offscreen.isOpen()).toBe(false);
    });
  });

  it('SPEC-0012:IT-04 depois de cancelado o estado não muda mais (nem com mais progresso do offscreen) e o candidato pode ser baixado de novo', async () => {
    await startGated('manual');
    const { candidate } = await observeAndResolve(bg, o('/r/long.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    await offscreen.emit(jobId, {
      type: 'progress',
      segmentsDone: 4,
      segmentsTotal: SEGMENTS,
      bytesDone: 400,
    });
    await bg.send({ type: 'cancel', jobId });
    const frozen = await jobOf(bg, jobId);

    await offscreen.emit(jobId, {
      type: 'progress',
      segmentsDone: 9,
      segmentsTotal: SEGMENTS,
      bytesDone: 900,
    });

    expect(frozen).toMatchObject({ state: 'canceled', segmentsDone: 4 });
    expect(await jobOf(bg, jobId)).toEqual(frozen);
    expect(await startDownload(bg, candidate.id)).toMatchObject({ ok: true });
  });

  it('SPEC-0012:IT-04 cancelar com o arquivo já montado (saving) revoga a blob URL e não deixa o download seguir', async () => {
    server = await startPlaylistServer(clipRoutes());
    offscreen = simulateOffscreen(bg);
    bg.download.mockResolvedValue(5);
    const { candidate } = await observeAndResolve(bg, o('/hls/clip/master.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    const blobUrl = offscreen.createdBlobUrls[0] ?? '';
    expect(blobUrl).toMatch(/^blob:/);
    expect(offscreen.revoked).toEqual([]);

    expect(await bg.send({ type: 'cancel', jobId })).toEqual({ ok: true });

    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'canceled' });
    await vi.waitFor(() => {
      expect(offscreen.revoked).toEqual([blobUrl]);
    });
    await vi.waitFor(() => {
      expect(bg.offscreen.isOpen()).toBe(false);
    });
    // Um "complete" tardio do navegador não ressuscita o job.
    await bg.downloadEvents.complete(5);
    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'canceled' });
  });

  it('SPEC-0012:IT-04 evento ready que chega depois do cancelamento não baixa nada e revoga a blob URL', async () => {
    await startGated('manual');
    const { candidate } = await observeAndResolve(bg, o('/r/long.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    await bg.send({ type: 'cancel', jobId });

    await offscreen.emit(jobId, {
      type: 'ready',
      blobUrl: 'blob:chrome-extension://x/late',
      bytes: 10,
    });

    expect(bg.download).not.toHaveBeenCalled();
    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'canceled' });
    await vi.waitFor(() => {
      expect(offscreen.revoked).toContain('blob:chrome-extension://x/late');
    });
  });

  it('SPEC-0012:IT-04 o job restaurado do storage.session depois de bg.restart() também pode ser cancelado', async () => {
    await startGated('manual');
    const { candidate } = await observeAndResolve(bg, o('/r/long.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    bg.restart();

    expect(await bg.send({ type: 'cancel', jobId })).toEqual({ ok: true });

    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'canceled' });
    expect(offscreen.commands.some((c) => c.type === 'cancel' && c.jobId === jobId)).toBe(true);
    await vi.waitFor(() => {
      expect(bg.offscreen.isOpen()).toBe(false);
    });
  });

  it('SPEC-0012:IT-04 cancelar um job deixa o outro, em andamento, intacto e o offscreen aberto', async () => {
    await startGated('manual');
    const tab = await bg.newTab();
    const a = await observeAndResolve(bg, o('/r/long.m3u8'), tab);
    const b = await observeAndResolve(bg, o('/hls/clip/v360.m3u8'), tab);
    const jobA = await startJob(bg, a.candidate.id);
    const jobB = await startJob(bg, b.candidate.id);

    await bg.send({ type: 'cancel', jobId: jobA.jobId });

    expect(await jobOf(bg, jobA.jobId)).toMatchObject({ state: 'canceled' });
    expect(await jobOf(bg, jobB.jobId)).toMatchObject({
      state: expect.stringMatching(/^(queued|running)$/) as string,
    });
    expect(bg.offscreen.isOpen()).toBe(true);
    expect(bg.offscreen.closeDocument).not.toHaveBeenCalled();
  });
});
