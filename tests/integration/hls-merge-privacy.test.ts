/**
 * Contrato usado (SPEC-0014 §5/§6, ADR-0009) — privacidade com áudio separado: URLs da master, das playlists e
 * dos arquivos de VÍDEO e de ÁUDIO com `?token=...&expires=...` (e chave com token) nunca aparecem em
 * diagnósticos, console, estado do job, nome do arquivo, argumentos de `downloads.download` nem em respostas de
 * erro — quando o job conclui, quando falha (áudio com Range ignorado -> FETCH_FAILED) e quando é recusado
 * (áudio criptografado). Background real + offscreen real + servidor HTTP local real com `Range`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import {
  captureDownloads,
  jobOf,
  observeAndResolve,
  startJob,
  waitForJob,
} from './support/hls-job';
import { simulateOffscreen } from './support/offscreen';
import { startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import {
  AUDIO_MEDIA,
  STREAM,
  captureConsole,
  masterOf,
  mediaLog,
  splitRoutes,
  splitTrack,
  startSplitDownload,
  withKey,
} from './support/split-av';
import type { SplitRoutesOptions } from './support/split-av';
import { inspectMp4 } from '../unit/support/mp4';

const video = splitTrack('video');
const audio = splitTrack('audio');
const SECRETS = [
  'token=',
  'expires=',
  'mastok',
  'vidtok',
  'audtok',
  'segvtok',
  'segatok',
  'keytok',
  'pagetok',
];

const MASTER = masterOf(
  AUDIO_MEDIA('a1', 'English', 'audio.m3u8?token=audtok&expires=222', { isDefault: true }),
  STREAM('video.m3u8?token=vidtok&expires=111', 'a1'),
);
const videoPlaylist = video.playlist.replaceAll('video.mp4', 'video.mp4?token=segvtok&expires=1');
const audioPlaylist = audio.playlist.replaceAll('audio.mp4', 'audio.mp4?token=segatok&expires=2');

let bg: BackgroundHarness;
let server: PlaylistServer;
let logged: string[];
const o = (path: string): string => `${server.origin}${path}`;

beforeEach(() => {
  bg = startBackground();
  logged = captureConsole();
});
afterEach(async () => {
  await server.close();
});

async function serve(options: SplitRoutesOptions = {}): Promise<void> {
  server = await startPlaylistServer(
    splitRoutes('/av', { master: MASTER, videoPlaylist, audioPlaylist, ...options }),
  );
  simulateOffscreen(bg);
}

function expectClean(text: string, label: string): void {
  for (const secret of SECRETS) {
    expect(text, `${label}: contém "${secret}"`).not.toContain(secret);
  }
}
async function diagnosticsText(): Promise<string> {
  const response = (await bg.send({ type: 'diagnostics' })) as { ok: boolean; entries: unknown[] };
  expect(response.ok).toBe(true);
  return JSON.stringify(response.entries);
}
const pageWithToken = (): Promise<number> =>
  bg.newTab('https://site.example.test/aula?token=pagetok');

describe('privacidade com vídeo e áudio separados', () => {
  it('SPEC-0014:IT-09 job concluído (tokens na master, playlists e arquivos): o MP4 tem as 2 trilhas e nada vaza', async () => {
    await serve();
    const saved = captureDownloads(bg, 12);
    const tab = await pageWithToken();
    const { candidate } = await observeAndResolve(
      bg,
      o('/av/master.m3u8?token=mastok&expires=9'),
      tab,
    );

    const { jobId } = await startJob(bg, candidate.id);
    await waitForJob(bg, jobId, (j) => j.state === 'saving');
    await bg.downloadEvents.complete(12);
    const done = await waitForJob(bg, jobId, (j) => j.state === 'done');

    expect(
      inspectMp4(saved[0]?.bytes ?? new Uint8Array())
        .tracks.map((t) => t.handler)
        .sort(),
    ).toEqual(['soun', 'vide']);
    const media = mediaLog(server);
    expect(media.some((r) => r.url.includes('token=segvtok&expires=1'))).toBe(true);
    expect(media.some((r) => r.url.includes('token=segatok&expires=2'))).toBe(true);
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
    expectClean(JSON.stringify(done), 'estado do job');
    expectClean(JSON.stringify(saved.map((s) => [s.url, s.filename])), 'downloads.download');
  });

  it('SPEC-0014:IT-09 job que falha (arquivo de ÁUDIO ignora o Range): FETCH_FAILED e nenhum token em erro, estado, diagnóstico ou console', async () => {
    await serve({ audioMode: 'ignore' });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8?token=mastok&expires=9'));

    const { jobId } = await startJob(bg, candidate.id);
    const failed = await waitForJob(bg, jobId, (j) => j.state === 'error');

    expect(failed.error).toBe('FETCH_FAILED');
    expect(bg.download).not.toHaveBeenCalled();
    expectClean(JSON.stringify(await jobOf(bg, jobId)), 'estado do job');
    expectClean(JSON.stringify(failed), 'erro do job');
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
  });

  it('SPEC-0014:IT-09 recusa por áudio criptografado (chave com token): resposta, diagnóstico e console sem token', async () => {
    await serve({
      audioPlaylist: withKey(audioPlaylist, 'key.bin?token=keytok&expires=3'),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8?token=mastok&expires=9'));

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    expectClean(JSON.stringify(response), 'resposta');
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
    expect(mediaLog(server)).toEqual([]);
  });

  it('SPEC-0014:IT-09 recusa por playlist de áudio 404 (com token na URL): respostas e logs sem token', async () => {
    await serve({
      audioPlaylist: (_req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      },
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8?token=mastok&expires=9'));

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expectClean(JSON.stringify(response), 'resposta');
    expectClean(await diagnosticsText(), 'diagnóstico');
    expectClean(logged.join('\n'), 'console');
  });
});
