/**
 * Contrato usado (SPEC-0016:IT-02, IT-03, IT-04, IT-05 no job) — background REAL + fakeBrowser + offscreen
 * REAL simulado (executa o `runOffscreenJob` de produção com o `fetch` do Node) + servidor HTTP local REAL +
 * fake de `declarativeNetRequest` (tests/integration/support/dnr.ts):
 *  - o servidor só responde a playlists, init e segmentos com `Origin: PLAYER` + `Referer: PLAYER/`;
 *  - quando o resolve precisou do contexto, UMA regra de sessão (a mesma do resolve: hosts das URLs do job,
 *    `Origin`/`Referer` do `initiatorOrigin`) cobre o job inteiro: nenhum segmento/init é recusado e todos
 *    aplicam a mesma regra; ao terminar (`done`, `error`, `canceled`) nenhuma regra da faixa 7_000_000+ sobra;
 *  - regras órfãs de um service worker anterior são removidas na partida (`bg.restart()`); regras de outros
 *    usos (ids fora da faixa reservada) ficam;
 *  - no máximo 4 regras simultâneas; query/token nunca entram na regra nem nos logs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import type { DnrHarness } from './support/dnr';
import {
  PLAYER,
  RESERVED_ID,
  expectAcceptedOnesCarriedContext,
  guarded,
  observeFrom,
  resolve,
  seenOn,
} from './support/context';
import {
  captureDownloads,
  clipRoutes,
  fileHandler,
  isPlaylistPath,
  isSegmentPath,
  jobOf,
  startDownload,
  startJob,
  waitForJob,
} from './support/hls-job';
import { simulateOffscreen } from './support/offscreen';
import { requireContext, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';
import { CLIP_DIR } from '../unit/support/hls-clip';
import { inspectMp4 } from '../unit/support/mp4';

let bg: BackgroundHarness & { dnr: DnrHarness };
let server: PlaylistServer;

const o = (path: string): string => `${server.origin}${path}`;
const MASTER = '/hls/clip/master.m3u8';
const HOST = '127.0.0.1';

beforeEach(() => {
  bg = startBackground({ dnr: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

async function start(routes: Record<string, Handler>): Promise<void> {
  server = await startPlaylistServer(routes);
  simulateOffscreen(bg);
}

async function resolved(path = MASTER): Promise<string> {
  const candidate = await observeFrom(bg, o(path));
  expect(await resolve(bg, candidate.id), 'resolveHls').toMatchObject({ ok: true });
  return candidate.id;
}

async function rulesGone(): Promise<void> {
  await vi.waitFor(() => {
    expect(bg.dnr.ids()).toEqual([]);
  });
}

describe('download com o contexto da página', () => {
  it('SPEC-0016:IT-02 playlist, init e segmentos exigem contexto: o job termina done, uma regra cobre os hosts do job e ela é removida', async () => {
    await start(guarded(clipRoutes()));
    const saved = captureDownloads(bg, 77);
    const candidateId = await resolved();

    const { jobId } = await startJob(bg, candidateId);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);

    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');
    expect(done.error).toBeUndefined();
    const info = inspectMp4(saved[0]?.bytes ?? new Uint8Array());
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'mdat']));

    const segments = server.log.filter((r) => isSegmentPath(r.url));
    expect(segments.length).toBeGreaterThanOrEqual(3);
    // A regra já cobria o job quando os segmentos saíram: nenhum foi recusado e todos levaram o contexto.
    expect(segments.every((r) => r.status === 200)).toBe(true);
    expectAcceptedOnesCarriedContext(server.log);
    const onSegments = bg.dnr.applied.filter((a) => isSegmentPath(a.url));
    expect(onSegments.length).toBe(segments.length);
    expect(new Set(onSegments.map((a) => a.ruleIds.join(','))).size).toBe(1);
    expect(onSegments[0]?.ruleIds).toHaveLength(1);

    const rules = bg.dnr.everAdded();
    expect(rules.length).toBeGreaterThanOrEqual(1);
    for (const rule of rules) {
      expect(rule.id).toBeGreaterThanOrEqual(RESERVED_ID);
      expect(rule.condition?.requestDomains).toEqual([HOST]);
      expect(rule.condition?.initiatorDomains).toEqual([bg.ownId]);
    }
    expect(bg.dnr.peak()).toBeLessThanOrEqual(4);
    await rulesGone();
  });

  it('SPEC-0016:IT-02 nenhuma requisição do job leva Cookie nem outro cabeçalho de contexto além de Origin/Referer', async () => {
    await start(guarded(clipRoutes()));
    captureDownloads(bg, 77);
    const candidateId = await resolved();

    const { jobId } = await startJob(bg, candidateId);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(server.log.some((r) => r.hasCookie)).toBe(false);
  });
});

describe('segurança do contexto no job', () => {
  it('SPEC-0016:IT-03 download com origin, referer, hosts e urls forjados na mensagem: nada disso chega à regra nem à rede', async () => {
    await start(guarded(clipRoutes()));
    captureDownloads(bg, 77);
    const candidateId = await resolved();

    const response = await bg.send({
      type: 'download',
      candidateId,
      origin: 'https://evil.test',
      referer: 'https://evil.test/roubo',
      hosts: ['evil.test'],
      urls: ['http://evil.test/segmento.ts'],
      initiatorOrigin: 'https://evil.test',
    });
    expect(response).toMatchObject({ ok: true, jobId: expect.any(String) as string });
    await waitForJob(bg, (response as { jobId: string }).jobId, (j) => j.state === 'saving');

    expect(bg.dnr.everAdded().length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(bg.dnr.everAdded())).not.toContain('evil');
    expect(bg.dnr.applied.some((a) => a.url.includes('evil'))).toBe(false);
    expect(server.log.some((r) => `${r.origin ?? ''}${r.referer ?? ''}`.includes('evil'))).toBe(
      false,
    );
  });

  it('SPEC-0016:IT-03 candidato sem initiatorOrigin: o download não instala regra e não repete (sem resolve possível)', async () => {
    await start(guarded(clipRoutes()));
    const candidate = await observeFrom(bg, o(MASTER), null);

    expect(await resolve(bg, candidate.id)).toMatchObject({ ok: false, status: 403 });
    const response = await startDownload(bg, candidate.id);

    expect(response.ok).toBe(false);
    expect(bg.dnr.everAdded()).toEqual([]);
    expect(seenOn(server, MASTER).every((r) => r.status === 403)).toBe(true);
  });
});

describe('privacidade do contexto no job', () => {
  const TOKEN = 'SEGREDO-do-token-123';
  const QUERY = `token=${TOKEN}&expires=1999999999`;

  /** O clipe REAL com `?token=…&expires=…` em toda URL das playlists (master, variantes e segmentos). */
  function tokenized(): Record<string, Handler> {
    const routes = clipRoutes();
    for (const name of ['master.m3u8', 'v360.m3u8', 'v180.m3u8']) {
      const text = readFileSync(join(CLIP_DIR, name), 'utf8').replace(
        /^(?!#)(\S+)$/gm,
        `$1?${QUERY}`,
      );
      routes[`/hls/clip/${name}`] = fileHandler(text, 'application/vnd.apple.mpegurl');
    }
    return guarded(routes);
  }

  it('SPEC-0016:IT-04 playlists e segmentos com ?token=…&expires=… : regra e logs do job sem query nem token', async () => {
    await start(tokenized());
    captureDownloads(bg, 77);
    const candidateId = await resolved(`${MASTER}?${QUERY}`);

    const { jobId } = await startJob(bg, candidateId);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(server.log.some((r) => isSegmentPath(r.url) && r.url.includes(TOKEN))).toBe(true);
    const rules = JSON.stringify(bg.dnr.everAdded());
    expect(bg.dnr.everAdded().length).toBeGreaterThanOrEqual(1);
    for (const forbidden of [TOKEN, 'token', 'expires', '1999999999', '?', '.m3u8', '.mpegts']) {
      expect(rules, forbidden).not.toContain(forbidden);
    }
    const { entries } = (await bg.send({ type: 'diagnostics' })) as { entries: unknown[] };
    const logs = JSON.stringify(entries);
    for (const forbidden of [TOKEN, 'token=', 'expires=', '1999999999', PLAYER]) {
      expect(logs, forbidden).not.toContain(forbidden);
    }
  });
});

describe('ciclo de vida das regras', () => {
  it('SPEC-0016:IT-05 job done: nenhuma regra da faixa reservada sobra', async () => {
    await start(guarded(clipRoutes()));
    captureDownloads(bg, 77);
    const candidateId = await resolved();

    const { jobId } = await startJob(bg, candidateId);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(77);
    await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(bg.dnr.everAdded().length).toBeGreaterThanOrEqual(1);
    await rulesGone();
  });

  it('SPEC-0016:IT-05 job que falha (segmento 404): estado error e nenhuma regra sobra', async () => {
    await start({
      ...guarded(clipRoutes()),
      '/hls/clip/v360-1.mpegts': requireContext(PLAYER, (_req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('gone');
      }),
    });
    captureDownloads(bg, 77);
    const candidateId = await resolved();

    const { jobId } = await startJob(bg, candidateId);

    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');
    expect(failed.error).toBe('FETCH_FAILED');
    expect(bg.dnr.everAdded().length).toBeGreaterThanOrEqual(1);
    await rulesGone();
  });

  it('SPEC-0016:IT-05 job cancelado no meio do download: nenhuma regra sobra', async () => {
    const hang: Handler = (req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': '100000' });
      res.flushHeaders();
      req.on('close', () => res.destroy());
    };
    await start({
      ...guarded(clipRoutes()),
      '/hls/clip/v360-1.mpegts': requireContext(PLAYER, hang),
      '/hls/clip/v360-2.mpegts': requireContext(PLAYER, hang),
    });
    const candidateId = await resolved();

    const { jobId } = await startJob(bg, candidateId);
    await vi.waitFor(() => {
      expect(server.requests.some((u) => u.includes('v360-1.mpegts'))).toBe(true);
    });
    expect(bg.dnr.ids().length).toBeGreaterThanOrEqual(1);
    expect(await bg.send({ type: 'cancel', jobId })).toEqual({ ok: true });

    expect((await jobOf(bg, jobId)).state).toBe('canceled');
    await rulesGone();
  });

  it('SPEC-0016:IT-05 resolve que falha duas vezes (403) não deixa regra', async () => {
    await start({
      '/hls/expired.m3u8': (_req, res) => {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('expired');
      },
    });
    const candidate = await observeFrom(bg, o('/hls/expired.m3u8'));

    expect(await resolve(bg, candidate.id)).toMatchObject({ ok: false, status: 403 });

    await rulesGone();
  });

  it('SPEC-0016:IT-05 service worker reiniciado com regras órfãs: elas são removidas na partida e as de outros usos ficam', async () => {
    await start(guarded(clipRoutes()));
    bg.dnr.seed([{ id: 5 }, { id: 7_000_001 }, { id: 7_000_042 }]);

    bg.restart();

    await vi.waitFor(() => {
      expect(bg.dnr.ids()).toEqual([5]);
    });
  });

  it('SPEC-0016:IT-05 depois da limpeza na partida, um novo resolve com contexto funciona e não colide', async () => {
    await start(guarded(clipRoutes()));
    bg.dnr.seed([{ id: 7_000_001 }]);
    bg.restart();
    await vi.waitFor(() => {
      expect(bg.dnr.ids()).toEqual([]);
    });

    const candidate = await observeFrom(bg, o(MASTER));

    expect(await resolve(bg, candidate.id)).toMatchObject({ ok: true });
    await rulesGone();
  });

  it('SPEC-0016:IT-05 (guarda) servidor que não exige contexto: o job termina sem criar regra e sem recusas', async () => {
    await start(clipRoutes());
    captureDownloads(bg, 77);
    const candidate = await observeFrom(bg, o(MASTER));
    expect(await resolve(bg, candidate.id)).toMatchObject({ ok: true });

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');

    expect(bg.dnr.everAdded()).toEqual([]);
    expect(server.log.filter((r) => isPlaylistPath(r.url)).every((r) => r.status === 200)).toBe(
      true,
    );
  });
});
