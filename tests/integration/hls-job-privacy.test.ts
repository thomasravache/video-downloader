/**
 * Contrato usado (SPEC-0012:IT-05) — logger REAL (mensagem {type:'diagnostics'} -> { ok:true, entries }) +
 * servidor HTTP local REAL que registra cada requisição (caminho + query):
 *  - com URLs de master, variante e segmentos contendo `?token=...` (e a página com `?token=`), nada que o
 *    background registra (diagnóstico, console, estado do job, nome do arquivo, argumentos de
 *    downloads.download) contém `token=` nem os valores secretos — em sucesso, em falha e em recusa;
 *  - o servidor só recebe requisições das playlists (master + variante) e dos segmentos do vídeo, e a
 *    query de cada URL é preservada na requisição (a URL é usada exatamente como listada na playlist).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import {
  captureDownloads,
  clipRoutes,
  fileHandler,
  jobOf,
  observeAndResolve,
  startDownload,
  startJob,
  waitForJob,
} from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';
import { clipFile } from '../unit/support/hls-clip';

const SECRETS = ['token=', 'abc123', 'var789', 'low456', 'seg0sec', 'seg1sec', 'seg2sec', 'pagina'];

let bg: BackgroundHarness;
let server: PlaylistServer;
let offscreen: SimulatedOffscreen;
let logged: string[];

const o = (path: string): string => `${server.origin}${path}`;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360
v360t.m3u8?token=var789
#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180
v180t.m3u8?token=low456
`;
const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXTINF:2.0,
seg0.mpegts?token=seg0sec
#EXTINF:2.0,
seg1.mpegts?token=seg1sec
#EXTINF:2.0,
seg2.mpegts?token=seg2sec
#EXT-X-ENDLIST
`;

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    '/p/master.m3u8': body(MASTER),
    '/p/v360t.m3u8': body(MEDIA),
    '/p/v180t.m3u8': body(MEDIA),
    '/p/seg0.mpegts': fileHandler(clipFile('v360-0.mpegts'), 'video/mp2t'),
    '/p/seg1.mpegts': fileHandler(clipFile('v360-1.mpegts'), 'video/mp2t'),
    '/p/seg2.mpegts': fileHandler(clipFile('v360-2.mpegts'), 'video/mp2t'),
    ...clipRoutes(),
    ...extra,
  };
}

async function start(extra: Record<string, Handler> = {}): Promise<void> {
  server = await startPlaylistServer(routes(extra));
  offscreen = simulateOffscreen(bg);
}

async function diagnosticsText(): Promise<string> {
  const response = (await bg.send({ type: 'diagnostics' })) as { ok: boolean; entries: unknown[] };
  expect(response.ok).toBe(true);
  return JSON.stringify(response.entries);
}

function expectClean(text: string, label: string): void {
  for (const secret of SECRETS) {
    expect(text, `${label}: contém "${secret}"`).not.toContain(secret);
  }
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

describe('privacidade do download HLS', () => {
  it('SPEC-0012:IT-05 job concluído com URLs ?token=...: diagnóstico, console, estado do job e downloads.download sem token', async () => {
    await start();
    const saved = captureDownloads(bg, 12);
    const tab = await bg.newTab('https://site.example.test/aula?token=pagina');
    const { candidate } = await observeAndResolve(bg, o('/p/master.m3u8?token=abc123'), tab);

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(12);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(done.filename).toMatch(/ - 360p\.mp4$/);
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
    expectClean(JSON.stringify(done), 'estado do job');
    expect(JSON.stringify(done)).not.toContain('://');
    expectClean(JSON.stringify(saved.map((s) => [s.url, s.filename])), 'downloads.download');
  });

  it('SPEC-0012:IT-05 o diagnóstico de um job registra eventos do job (correlação) e continua sem query', async () => {
    await start();
    bg.download.mockResolvedValue(3);
    const { candidate } = await observeAndResolve(bg, o('/p/master.m3u8?token=abc123'));
    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    const entries = (
      (await bg.send({ type: 'diagnostics' })) as {
        entries: { event: string; correlationId: string }[];
      }
    ).entries;

    const jobEntries = entries.filter((e) => /download|job/i.test(e.event));
    expect(jobEntries.length).toBeGreaterThan(0);
    expect(
      jobEntries.every((e) => typeof e.correlationId === 'string' && e.correlationId !== ''),
    ).toBe(true);
    expectClean(JSON.stringify(entries), 'diagnóstico');
  });

  it('SPEC-0012:IT-05 o servidor só recebe as playlists (master + variante) e os segmentos do vídeo, com a query tal como listada', async () => {
    await start();
    bg.download.mockResolvedValue(4);
    const { candidate } = await observeAndResolve(bg, o('/p/master.m3u8?token=abc123'));
    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    const unique = [...new Set(server.requests)].sort();
    expect(unique).toEqual(
      [
        '/p/master.m3u8?token=abc123',
        '/p/v360t.m3u8?token=var789',
        '/p/seg0.mpegts?token=seg0sec',
        '/p/seg1.mpegts?token=seg1sec',
        '/p/seg2.mpegts?token=seg2sec',
      ].sort(),
    );
    // Cada segmento foi pedido uma única vez; nada de outra variante, chave, favicon ou página.
    expect(server.requests.filter((r) => r.includes('mpegts'))).toHaveLength(3);
  });

  it('SPEC-0012:IT-05 falha definitiva de um segmento (404) com ?token=...: erro do job e logs sem token', async () => {
    await start({
      '/p/seg1.mpegts': (_req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('nao existe');
      },
    });
    const { candidate } = await observeAndResolve(bg, o('/p/master.m3u8?token=abc123'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('FETCH_FAILED');
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
    expectClean(JSON.stringify(failed), 'estado do job');
  });

  it('SPEC-0012:IT-05 recusa de playlist criptografada com ?token=...: resposta e logs sem token e nenhum segmento requisitado', async () => {
    await start({
      '/p/enc.m3u8': body(
        MEDIA.replace(
          '#EXTINF:2.0,',
          '#EXT-X-KEY:METHOD=AES-128,URI="k.bin?token=low456"\n#EXTINF:2.0,',
        ),
      ),
    });
    const { candidate } = await observeAndResolve(bg, o('/p/enc.m3u8?token=abc123'));

    const response = await startDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
    expect(server.requests.some((r) => r.includes('mpegts') || r.includes('k.bin'))).toBe(false);
  });

  it('SPEC-0012:IT-05 cancelar um job com ?token=...: logs sem token e blob URL revogada quando existia', async () => {
    await start();
    bg.download.mockResolvedValue(8);
    const { candidate } = await observeAndResolve(bg, o('/p/master.m3u8?token=abc123'));
    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    await bg.send({ type: 'cancel', jobId });

    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'canceled' });
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
    await vi.waitFor(() => {
      expect(offscreen.revoked).toEqual(offscreen.createdBlobUrls);
    });
  });
});
