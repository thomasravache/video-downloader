/**
 * Ajudantes dos testes de integração de jobs de download HLS (SPEC-0012). Não é teste.
 *
 *  - `clipRoutes`: serve e2e/fixtures/hls/clip (playlists e segmentos REAIS) sobre o servidor HTTP local;
 *  - `observeHls` / `resolveHls`: o candidato HLS vem da rede (webRequest) e é resolvido como o popup faz;
 *  - `startDownload`, `jobOf`, `waitForJob`: mensagens `download` / `job` do contrato (SPEC-0012 §6).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import { CLIP_DIR } from '../../unit/support/hls-clip';
import type { BackgroundHarness } from './background';
import { injected, page } from './background';
import { HLS_TYPE, rangeHandler } from './playlist-server';
import type { Handler } from './playlist-server';
import type { DetectResponse, VideoCandidate } from '../../../src/core/contracts';
import type { JobState } from '../../../src/core/hls-download';

export const PAGE = 'https://site.example.test/aula';
export const HLS_HEADERS = { 'Content-Type': HLS_TYPE, 'Content-Length': '700' };

const TYPES: Record<string, string> = {
  '.m3u8': HLS_TYPE,
  '.mpegts': 'video/mp2t',
  '.m4s': 'video/mp4',
  '.mp4': 'video/mp4',
};

function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? filesUnder(path, `${prefix}${name}/`)
      : [`${prefix}${name}`];
  });
}

export function fileHandler(bytes: Uint8Array | string, contentType: string): Handler {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  const ranged = rangeHandler(buf, { contentType });
  return (req, res) => {
    if (req.headers['range']) {
      ranged(req, res);
      return;
    }
    const body = Buffer.from(buf);
    res.writeHead(200, { 'content-type': contentType, 'content-length': body.byteLength });
    res.end(body);
  };
}

/** Uma rota por arquivo do clipe: `<prefix>/<arquivo>` (ex.: /hls/clip/master.m3u8, /hls/clip/v360-0.mpegts). */
export function clipRoutes(prefix = '/hls/clip'): Record<string, Handler> {
  const routes: Record<string, Handler> = {};
  for (const rel of filesUnder(CLIP_DIR)) {
    const extension = rel.slice(rel.lastIndexOf('.'));
    routes[`${prefix}/${rel}`] = fileHandler(
      readFileSync(join(CLIP_DIR, rel)),
      TYPES[extension] ?? 'application/octet-stream',
    );
  }
  return routes;
}

export const isPlaylistPath = (path: string): boolean => /\.m3u8(\?|$)/.test(path);
export const isSegmentPath = (path: string): boolean =>
  /\.(mpegts|ts|m4s)(\?|$)/.test(path) || /init\.mp4(\?|$)/.test(path);

/** Observa `url` como resposta HLS da aba e devolve o candidato listado por `detect`. */
export async function observeHls(
  bg: BackgroundHarness,
  url: string,
  tabId?: number,
): Promise<VideoCandidate> {
  const tab = tabId ?? (await bg.newTab(PAGE));
  await bg.network.respond({ url, tabId: tab, headers: HLS_HEADERS });
  return detectCandidate(bg, tab, url);
}

export async function detectCandidate(
  bg: BackgroundHarness,
  tabId: number,
  url: string,
): Promise<VideoCandidate> {
  bg.executeScript.mockResolvedValue([injected({ frameId: 0, snapshot: page([]) })]);
  const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;
  if (!response.ok) {
    throw new Error(`detect falhou: ${JSON.stringify(response)}`);
  }
  const found = response.candidates.find((c) => c.mediaUrl === url);
  if (!found) {
    throw new Error(`candidato ${url} ausente: ${JSON.stringify(response.candidates)}`);
  }
  return found;
}

/** Observa e resolve (como o popup) e devolve o candidato já com `hls`. */
export async function observeAndResolve(bg: BackgroundHarness, url: string, tabId?: number) {
  const candidate = await observeHls(bg, url, tabId);
  const response = await bg.send({ type: 'resolveHls', candidateId: candidate.id });
  expect(response, 'resolveHls').toMatchObject({ ok: true });
  return { candidate: await detectCandidate(bg, candidate.tabId, url), response };
}

export type DownloadResult = { ok: true; jobId: string } | { ok: false; error: string };

export async function startDownload(
  bg: BackgroundHarness,
  candidateId: string,
  variantIndex?: number,
): Promise<DownloadResult> {
  return (await bg.send({
    type: 'download',
    candidateId,
    ...(variantIndex !== undefined && { variantIndex }),
  })) as DownloadResult;
}

/** `download` esperando sucesso: falha na hora, com a resposta, se o job não foi criado. */
export async function startJob(
  bg: BackgroundHarness,
  candidateId: string,
  variantIndex?: number,
): Promise<{ jobId: string }> {
  const response = await startDownload(bg, candidateId, variantIndex);
  if (!response.ok) {
    throw new Error(`download não criou o job: ${JSON.stringify(response)}`);
  }
  return { jobId: response.jobId };
}

export async function jobOf(bg: BackgroundHarness, jobId: string): Promise<JobState> {
  const response = (await bg.send({ type: 'job', jobId })) as {
    ok: boolean;
    job?: JobState;
    error?: string;
  };
  if (!response.ok || !response.job) {
    throw new Error(`job ${jobId}: ${JSON.stringify(response)}`);
  }
  return response.job;
}

/** Espera (com limite) o job satisfazer `check`; devolve o último estado. */
export async function waitForJob(
  bg: BackgroundHarness,
  jobId: string,
  check: (job: JobState) => boolean,
  timeout = 8_000,
): Promise<JobState> {
  let last: JobState | undefined;
  await vi.waitFor(
    async () => {
      last = await jobOf(bg, jobId);
      expect(check(last), `estado atual: ${JSON.stringify(last)}`).toBe(true);
    },
    { timeout, interval: 15 },
  );
  return last as JobState;
}

/** Bytes de uma blob URL do Node (só vale enquanto ela não for revogada). */
export async function bytesOfBlobUrl(url: string): Promise<Uint8Array> {
  const { resolveObjectURL } = await import('node:buffer');
  const blob = resolveObjectURL(url);
  if (!blob) {
    throw new Error(`blob URL não encontrada: ${url}`);
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Faz `downloads.download` guardar, na hora da chamada, os bytes da blob URL recebida (a revogação
 * vem depois). Devolve a lista de capturas.
 */
export function captureDownloads(
  bg: BackgroundHarness,
  downloadId = 77,
): { url: string; filename: string; bytes: Uint8Array }[] {
  const captured: { url: string; filename: string; bytes: Uint8Array }[] = [];
  bg.download.mockImplementation(async (options: { url: string; filename: string }) => {
    captured.push({
      url: options.url,
      filename: options.filename,
      bytes: await bytesOfBlobUrl(options.url),
    });
    return downloadId;
  });
  return captured;
}
