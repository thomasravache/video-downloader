/**
 * Contrato usado (SPEC-0012, revisão independente) — background REAL + fakeBrowser + offscreen simulado (manual):
 *  MAJOR-1  (removido pela SPEC-0013: byte range deixou de ser recusado; ver tests/integration/hls-job-byterange.test.ts)
 *  MAJOR-2  job ativo cujo documento offscreen sumiu (OffscreenPort.isOpen() via runtime.getContexts) é
 *           falhado com ASSEMBLY_FAILED em `create` e em `job`: libera o candidato e a vaga (TOO_MANY_JOBS);
 *           nada é revogado;
 *  MINOR-1  evento do offscreen só vale com sender.id da extensão E sender.url terminando em /offscreen.html;
 *  MINOR-3  sem `downloads.onChanged` o diagnóstico registra downloads.unavailable; falha de addListener propaga;
 *  MINOR-4  evento do offscreen para jobId desconhecido -> o background manda `cancel` desse jobId;
 *  MINOR-5  download interrompido com error USER_CANCELED (cancelado no Chrome) -> job 'canceled', não 'error'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../../entrypoints/background';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import { fileHandler, jobOf, observeAndResolve, startDownload, startJob } from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';

let bg: BackgroundHarness;
let server: PlaylistServer;
let offscreen: SimulatedOffscreen;

const o = (path: string): string => `${server.origin}${path}`;
const DUMMY: Handler = fileHandler(new Uint8Array(64).fill(1), 'video/mp2t');
const head = '#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:2\n';
const plain = `${head}#EXTINF:2.0,\ns0.mpegts\n#EXTINF:2.0,\ns1.mpegts\n#EXT-X-ENDLIST\n`;

async function start(extra: Record<string, Handler> = {}): Promise<void> {
  server = await startPlaylistServer({
    '/r/s0.mpegts': DUMMY,
    '/r/s1.mpegts': DUMMY,
    '/r/a.m3u8': body(plain),
    '/r/b.m3u8': body(plain),
    '/r/c.m3u8': body(plain),
    ...extra,
  });
  offscreen = simulateOffscreen(bg, { mode: 'manual' });
}

beforeEach(() => {
  bg = startBackground();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

type Trigger = { trigger(...args: unknown[]): Promise<unknown[]> };

/** Mensagem do offscreen com um `sender` arbitrário; devolve o que o background respondeu. */
async function fromSender(message: unknown, sender: Record<string, unknown>): Promise<unknown> {
  let respond: (value: unknown) => void = () => undefined;
  const responded = new Promise<unknown>((resolve) => {
    respond = resolve;
  });
  const results = await (fakeBrowser.runtime.onMessage as unknown as Trigger).trigger(
    message,
    sender,
    respond,
  );
  const promised = results.find((r) => r instanceof Promise) as Promise<unknown> | undefined;
  if (promised) {
    return promised;
  }
  return Promise.race([responded, new Promise((resolve) => setTimeout(resolve, 300, 'timeout'))]);
}

describe('MAJOR-2: job ativo com o offscreen sumido é recuperado', () => {
  it('SPEC-0012:IT-04 consulta do job (`job`) falha o job com ASSEMBLY_FAILED e não revoga nada', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/a.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    expect((await jobOf(bg, jobId)).state).toBe('running');

    await fakeBrowser.offscreen.closeDocument();

    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'error', error: 'ASSEMBLY_FAILED' });
    expect(offscreen.commands.filter((c) => c.type === 'revoke')).toEqual([]);
  });

  it('SPEC-0012:IT-04 novo download do mesmo candidato recupera o job órfão em vez de JOB_ALREADY_RUNNING', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/a.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    await fakeBrowser.offscreen.closeDocument();

    const again = await startDownload(bg, candidate.id);

    expect(again.ok).toBe(true);
    expect((again as { jobId: string }).jobId).not.toBe(jobId);
    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'error', error: 'ASSEMBLY_FAILED' });
    expect(bg.offscreen.isOpen()).toBe(true);
  });

  it('SPEC-0012:IT-04 as vagas de TOO_MANY_JOBS voltam quando o offscreen some com 2 jobs ativos', async () => {
    await start();
    const tabs = [await bg.newTab(), await bg.newTab(), await bg.newTab()];
    const [a, b, c] = await Promise.all(
      ['a', 'b', 'c'].map(
        async (name, i) => (await observeAndResolve(bg, o(`/r/${name}.m3u8`), tabs[i])).candidate,
      ),
    );
    await startJob(bg, (a as { id: string }).id);
    await startJob(bg, (b as { id: string }).id);
    expect(await startDownload(bg, (c as { id: string }).id)).toEqual({
      ok: false,
      error: 'TOO_MANY_JOBS',
    });

    await fakeBrowser.offscreen.closeDocument();

    expect((await startDownload(bg, (c as { id: string }).id)).ok).toBe(true);
  });

  it('SPEC-0012:IT-04 (guarda) com o offscreen aberto o job ativo continua ativo', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/a.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);

    expect((await jobOf(bg, jobId)).state).toBe('running');
    expect(await startDownload(bg, candidate.id)).toEqual({
      ok: false,
      error: 'JOB_ALREADY_RUNNING',
    });
  });
});

describe('MINOR-1: origem dos eventos do offscreen', () => {
  const progress = { type: 'progress', segmentsDone: 1, segmentsTotal: 2, bytesDone: 10 } as const;

  it('SPEC-0012:IT-05 evento com sender.url que não é o offscreen (ou ausente) é ignorado', async () => {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/a.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    const message = { target: 'background', jobId, event: progress };

    await fromSender(message, { id: bg.ownId });
    await fromSender(message, { id: bg.ownId, url: `chrome-extension://${bg.ownId}/popup.html` });
    await fromSender(message, { id: bg.ownId, url: 'https://evil.example.test/offscreen.html' });
    expect((await jobOf(bg, jobId)).segmentsDone).toBe(0);

    await fromSender(message, {
      id: bg.ownId,
      url: `chrome-extension://${bg.ownId}/offscreen.html`,
    });
    expect((await jobOf(bg, jobId)).segmentsDone).toBe(1);
  });
});

describe('MINOR-3: downloads.onChanged ausente', () => {
  const remount = (): void => {
    fakeBrowser.runtime.onMessage.removeAllListeners();
    fakeBrowser.tabs.onRemoved.removeAllListeners();
    background.main();
  };

  it('SPEC-0012:IT-02 sem downloads.onChanged o main() não lança e o diagnóstico registra downloads.unavailable', async () => {
    await start();
    Object.defineProperty(fakeBrowser.downloads, 'onChanged', {
      configurable: true,
      value: undefined,
    });

    expect(remount).not.toThrow();

    const { entries } = (await bg.send({ type: 'diagnostics' })) as {
      entries: Record<string, unknown>[];
    };
    expect(entries.some((e) => e['event'] === 'downloads.unavailable')).toBe(true);
  });

  it('SPEC-0012:IT-02 addListener que lança não é engolido', async () => {
    await start();
    Object.defineProperty(fakeBrowser.downloads, 'onChanged', {
      configurable: true,
      value: {
        addListener: () => {
          throw new TypeError('boom');
        },
      },
    });

    expect(remount).toThrow(TypeError);
  });
});

describe('MINOR-4: evento de job desconhecido', () => {
  it('SPEC-0012:IT-04 progresso de um jobId que o background não conhece -> cancel desse jobId ao offscreen', async () => {
    await start();

    await offscreen.emit('fantasma', {
      type: 'progress',
      segmentsDone: 1,
      segmentsTotal: 2,
      bytesDone: 10,
    });

    expect(offscreen.commands).toContainEqual({
      target: 'offscreen',
      type: 'cancel',
      jobId: 'fantasma',
    });
  });
});

describe('MINOR-5: download cancelado pelo usuário no navegador', () => {
  async function saving(): Promise<string> {
    await start();
    const { candidate } = await observeAndResolve(bg, o('/r/a.m3u8'));
    const { jobId } = await startJob(bg, candidate.id);
    await offscreen.emit(jobId, { type: 'assembling' });
    await offscreen.emit(jobId, { type: 'ready', blobUrl: 'blob:nodedata:abc', bytes: 10 });
    expect((await jobOf(bg, jobId)).state).toBe('saving');
    return jobId;
  }

  it('SPEC-0012:IT-04 interrupted com error USER_CANCELED -> canceled', async () => {
    const jobId = await saving();

    await bg.downloadEvents.event.emit({
      id: 1,
      state: { current: 'interrupted' },
      error: { current: 'USER_CANCELED' },
    });

    expect((await jobOf(bg, jobId)).state).toBe('canceled');
  });

  it('SPEC-0012:IT-04 (guarda) interrupted por outro erro continua DOWNLOAD_FAILED', async () => {
    const jobId = await saving();

    await bg.downloadEvents.event.emit({
      id: 1,
      state: { current: 'interrupted' },
      error: { current: 'NETWORK_FAILED' },
    });

    expect(await jobOf(bg, jobId)).toMatchObject({ state: 'error', error: 'DOWNLOAD_FAILED' });
  });
});
