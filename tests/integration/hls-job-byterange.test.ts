/**
 * Contrato usado (SPEC-0013 §6) — background REAL + fakeBrowser + offscreen REAL (runOffscreenJob) + servidor
 * HTTP local REAL com suporte a `Range` (tests/integration/support/playlist-server.ts: `rangeHandler`):
 *  - playlist de mídia fMP4 de ARQUIVO ÚNICO (EXT-X-MAP com BYTERANGE, segmentos `len@off` e `len`): o
 *    `download` monta o `start` com `ranges`/`initRange` e o offscreen busca cada trecho com
 *    `Range: bytes=<offset>-<offset+length-1>`; só `206` com `Content-Range` igual ao pedido vale;
 *  - qualquer outra resposta (200, Content-Range diferente) -> job `error` FETCH_FAILED, sem downloads.download;
 *  - soma das faixas (init + segmentos) > 1,5 GiB -> job `error` TOO_LARGE sem NENHUMA requisição de mídia;
 *  - byte range não afrouxa recusas: EXT-X-KEY não-NONE -> ENCRYPTED; candidato drm -> PROTECTED; sem mídia;
 *  - URLs com `?token=...&expires=...`: nada disso em diagnóstico, console, estado do job, nome do arquivo,
 *    argumentos de downloads.download nem erros.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import {
  captureDownloads,
  jobOf,
  observeAndResolve,
  startDownload,
  startJob,
  waitForJob,
} from './support/hls-job';
import { singleFileFixture } from './support/byte-range';
import { body, rangeHandler, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer, RangeMode } from './support/playlist-server';
import type { VideoCandidate } from '../../src/core/contracts';
import { inspectMp4 } from '../unit/support/mp4';

const fixture = singleFileFixture();
const isMedia = (url: string): boolean => /\/br\/media\.mp4(\?|$)/.test(url);
const mediaLog = (server: PlaylistServer) => server.log.filter((r) => isMedia(r.url));

let bg: BackgroundHarness;
let server: PlaylistServer;
let offscreen: SimulatedOffscreen;
let logged: string[];

const o = (path: string): string => `${server.origin}${path}`;

async function start(
  extra: Record<string, Handler> = {},
  mode: RangeMode = 'ok',
  offscreenMode: 'real' | 'manual' = 'real',
): Promise<void> {
  server = await startPlaylistServer({
    '/br/media.m3u8': body(fixture.playlist()),
    '/br/media.mp4': rangeHandler(fixture.file, { mode }),
    ...extra,
  });
  offscreen = simulateOffscreen(bg, { mode: offscreenMode });
}

beforeEach(() => {
  bg = startBackground();
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

describe('download de HLS com byte range (arquivo único)', () => {
  it('SPEC-0013:IT-01 job done: o Blob é init + trechos na ordem (bytes conferidos) e TODA requisição de mídia leva o Range certo', async () => {
    await start();
    const saved = captureDownloads(bg, 77);
    const { candidate } = await observeAndResolve(bg, o('/br/media.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const saving = await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(done.error).toBeUndefined();
    expect(saving).toMatchObject({ segmentsDone: 3, segmentsTotal: 3, percent: 100 });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.bytes).toEqual(fixture.expectedOutput);
    const media = mediaLog(server);
    expect(media.every((r) => r.range !== undefined)).toBe(true);
    expect(media.map((r) => r.range).sort()).toEqual([...fixture.ranges].sort());
    const info = inspectMp4(saved[0]?.bytes ?? new Uint8Array());
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.tracks.find((t) => t.handler === 'vide')).toMatchObject({
      width: 320,
      height: 180,
    });
  });

  it('SPEC-0013:IT-01 Content-Range com total "*" também é aceito', async () => {
    await start({}, 'total-star');
    const saved = captureDownloads(bg, 5);
    const { candidate } = await observeAndResolve(bg, o('/br/media.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(saved[0]?.bytes).toEqual(fixture.expectedOutput);
  });

  it('SPEC-0013:IT-02 servidor que ignora Range (200): job error FETCH_FAILED, nada entregue ao chrome.downloads', async () => {
    await start({}, 'ignore');
    const { candidate } = await observeAndResolve(bg, o('/br/media.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('FETCH_FAILED');
    expect(mediaLog(server).length).toBeGreaterThan(0);
    expect(mediaLog(server).every((r) => r.range !== undefined)).toBe(true);
    expect(bg.download).not.toHaveBeenCalled();
    await offscreen.idle();
    expect(offscreen.createdBlobUrls).toEqual([]);
  });

  it('SPEC-0013:IT-03 206 com Content-Range de outro intervalo: job error FETCH_FAILED e nada baixado', async () => {
    await start({}, 'wrong-content-range');
    const { candidate } = await observeAndResolve(bg, o('/br/media.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('FETCH_FAILED');
    expect(bg.download).not.toHaveBeenCalled();
    expect(offscreen.createdBlobUrls).toEqual([]);
  });

  it('SPEC-0013:IT-03 206 sem Content-Range não é prova do trecho pedido: job error FETCH_FAILED', async () => {
    await start({}, 'no-content-range');
    const { candidate } = await observeAndResolve(bg, o('/br/media.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('FETCH_FAILED');
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0013:IT-04 faixas que somam mais de 1,5 GiB (só metadados): TOO_LARGE sem nenhuma requisição de mídia', async () => {
    const huge = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MAP:URI="media.mp4",BYTERANGE="893@0"',
      '#EXTINF:2.0,',
      '#EXT-X-BYTERANGE:1073741824@1573',
      'media.mp4',
      '#EXTINF:2.0,',
      '#EXT-X-BYTERANGE:600000000',
      'media.mp4',
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');
    await start({ '/br/huge.m3u8': body(huge) });
    const { candidate } = await observeAndResolve(bg, o('/br/huge.m3u8'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('TOO_LARGE');
    expect(mediaLog(server)).toEqual([]);
    expect(bg.download).not.toHaveBeenCalled();
  });
});

describe('byte range não afrouxa recusas de criptografia e DRM', () => {
  const encrypted = (): string =>
    fixture.playlist().replace('#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-KEY:METHOD=AES-128,URI="k.bin"');

  /** Regrava o candidato no storage.session e reinicia o service worker. */
  async function tamper(candidate: VideoCandidate, changes: Partial<VideoCandidate>) {
    const key = `vd:net:${String(candidate.tabId)}`;
    const stored = (await fakeBrowser.storage.session.get(key))[key] as {
      at: number;
      candidate: VideoCandidate;
    }[];
    await fakeBrowser.storage.session.set({
      [key]: stored.map((entry) =>
        entry.candidate.id === candidate.id
          ? { ...entry, candidate: { ...entry.candidate, ...changes } }
          : entry,
      ),
    });
    bg.restart();
  }

  it('SPEC-0013:IT-05 byte range + EXT-X-KEY AES-128: ENCRYPTED, nenhuma requisição de mídia nem de chave, nenhum download', async () => {
    await start({ '/br/enc.m3u8': body(encrypted()) }, 'ok', 'manual');
    const { candidate } = await observeAndResolve(bg, o('/br/enc.m3u8'));

    expect(await startDownload(bg, candidate.id)).toEqual({ ok: false, error: 'ENCRYPTED' });

    expect(mediaLog(server)).toEqual([]);
    expect(server.requests.some((r) => r.includes('k.bin'))).toBe(false);
    expect(offscreen.starts()).toEqual([]);
    expect(bg.download).not.toHaveBeenCalled();
  });

  it('SPEC-0013:IT-05 candidato drm com byte range: PROTECTED, nenhuma requisição ao servidor', async () => {
    await start({}, 'ok', 'manual');
    const { candidate } = await observeAndResolve(bg, o('/br/media.m3u8'));
    await tamper(candidate, { protection: 'drm' });
    const before = server.requests.length;

    expect(await startDownload(bg, candidate.id)).toEqual({ ok: false, error: 'PROTECTED' });

    expect(server.requests.length).toBe(before);
    expect(offscreen.starts()).toEqual([]);
    expect(bg.download).not.toHaveBeenCalled();
  });
});

describe('privacidade com byte range', () => {
  const SECRETS = ['token=', 'expires=', 'plltok', 'maptok', 'segtok', 'pagetok'];
  const tokenPlaylist = (): string => fixture.playlist('media.mp4?token=segtok&expires=999');

  function expectClean(text: string, label: string): void {
    for (const secret of SECRETS) {
      expect(text, `${label}: contém "${secret}"`).not.toContain(secret);
    }
  }
  async function diagnosticsText(): Promise<string> {
    const response = (await bg.send({ type: 'diagnostics' })) as {
      ok: boolean;
      entries: unknown[];
    };
    expect(response.ok).toBe(true);
    return JSON.stringify(response.entries);
  }

  it('SPEC-0013:IT-06 job concluído com ?token=&expires= na playlist e nos trechos: diagnóstico, console, estado do job e downloads.download sem token', async () => {
    await start({ '/br/tok.m3u8': body(tokenPlaylist()) });
    const saved = captureDownloads(bg, 12);
    const tab = await bg.newTab('https://site.example.test/aula?token=pagetok');
    const { candidate } = await observeAndResolve(
      bg,
      o('/br/tok.m3u8?token=plltok&expires=1'),
      tab,
    );

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(12);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(saved[0]?.bytes).toEqual(fixture.expectedOutput);
    expect(mediaLog(server).every((r) => r.url.includes('token=segtok&expires=999'))).toBe(true);
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
    expectClean(JSON.stringify(done), 'estado do job');
    expectClean(JSON.stringify(saved.map((s) => [s.url, s.filename])), 'downloads.download');
  });

  it('SPEC-0013:IT-06 job que falha por Range ignorado (?token=): erro, estado do job e logs sem token', async () => {
    await start({ '/br/tok.m3u8': body(tokenPlaylist()) }, 'ignore');
    const { candidate } = await observeAndResolve(bg, o('/br/tok.m3u8?token=plltok&expires=1'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('FETCH_FAILED');
    expectClean(JSON.stringify(await jobOf(bg, jobId)), 'estado do job');
    expectClean(JSON.stringify(failed), 'erro do job');
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
  });

  it('SPEC-0013:IT-06 recusa por criptografia com byte range e ?token=: resposta e logs sem token', async () => {
    const enc = tokenPlaylist().replace(
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-KEY:METHOD=AES-128,URI="k.bin?token=maptok"',
    );
    await start({ '/br/tokenc.m3u8': body(enc) }, 'ok', 'manual');
    const { candidate } = await observeAndResolve(bg, o('/br/tokenc.m3u8?token=plltok'));

    const response = await startDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    expectClean(JSON.stringify(response), 'resposta');
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
  });
});
