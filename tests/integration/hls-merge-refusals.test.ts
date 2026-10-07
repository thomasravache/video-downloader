/**
 * Contrato usado (SPEC-0014 §6) — a fronteira de segurança fica no serviço: o `download` re-busca e re-analisa
 * a playlist de VÍDEO e a de ÁUDIO (nunca confia no estado guardado) e só cria o job se TODAS forem aprovadas;
 * em qualquer recusa não há NENHUMA requisição de mídia (nem do vídeo), nenhum `start` no offscreen e nenhum
 * `downloads.download` (nunca entrega vídeo mudo):
 *  - áudio com EXT-X-KEY (resolvido limpo e depois criptografado, ou faixa não padrão criptografada) -> ENCRYPTED;
 *  - playlist de áudio 404 / inválida -> HLS_NOT_RESOLVED; ao vivo -> LIVE;
 *  - `audioIndex` de outro grupo ou inexistente, e áudio ou vídeo que não seja fMP4 (TS) -> UNSUPPORTED.
 * Servidor HTTP local real com `Range`; fixtures de e2e/fixtures/hls/split-av.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { observeAndResolve } from './support/hls-job';
import { simulateOffscreen } from './support/offscreen';
import type { SimulatedOffscreen } from './support/offscreen';
import { body, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';
import {
  AUDIO_MEDIA,
  STREAM,
  masterOf,
  mediaLog,
  playlistLog,
  splitRoutes,
  splitTrack,
  startSplitDownload,
  tsPlaylist,
  withKey,
  withoutEndlist,
} from './support/split-av';

const video = splitTrack('video');
const audio = splitTrack('audio');

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

/** Servidor cuja playlist de áudio (e a de vídeo) pode mudar DEPOIS do resolve. */
async function serve(extra: Record<string, Handler> = {}) {
  const state = {
    audio: audio.playlist as string | Handler,
    video: video.playlist as string | Handler,
  };
  const dynamic = (key: 'audio' | 'video'): Handler => {
    return (req, res) => {
      const source = state[key];
      if (typeof source === 'string') {
        body(source)(req, res);
      } else {
        source(req, res);
      }
    };
  };
  server = await startPlaylistServer({
    ...splitRoutes('/av'),
    '/av/audio.m3u8': dynamic('audio'),
    '/av/video.m3u8': dynamic('video'),
    ...extra,
  });
  offscreen = simulateOffscreen(bg, { mode: 'manual' });
  return state;
}

function expectNothingFetchedOrSaved(): void {
  expect(mediaLog(server)).toEqual([]);
  expect(offscreen.starts()).toEqual([]);
  expect(bg.download).not.toHaveBeenCalled();
}

describe('áudio criptografado', () => {
  it('SPEC-0014:IT-03 áudio limpo no resolve e com EXT-X-KEY AES-128 no download (vídeo limpo): ENCRYPTED, zero requisição de mídia, nem do vídeo', async () => {
    const state = await serve();
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    expect(candidate.protection).toBe('none');
    state.audio = withKey(audio.playlist, 'k.bin');
    const audioFetches = playlistLog(server).filter((p) => p === '/av/audio.m3u8').length;

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    // A playlist de áudio foi buscada de novo (nunca confia no estado do resolve).
    expect(playlistLog(server).filter((p) => p === '/av/audio.m3u8').length).toBeGreaterThan(
      audioFetches,
    );
    expectNothingFetchedOrSaved();
    expect(server.requests.some((r) => r.includes('k.bin'))).toBe(false);
  });

  it('SPEC-0014:IT-03 faixa NÃO padrão (audioIndex 1) criptografada, com a padrão limpa: ENCRYPTED e nada baixado', async () => {
    const master = masterOf(
      AUDIO_MEDIA('a1', 'English', 'audio.m3u8', { isDefault: true }),
      AUDIO_MEDIA('a1', 'Deutsch', 'audio-de.m3u8', { language: 'de' }),
      STREAM('video.m3u8', 'a1'),
    );
    await serve({
      '/av/master.m3u8': body(master),
      '/av/audio-de.m3u8': body(withKey(audio.playlist.replaceAll('audio.mp4', 'audio-de.mp4'))),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    expect(candidate.protection).toBe('none');

    const response = await startSplitDownload(bg, candidate.id, { variantIndex: 0, audioIndex: 1 });

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    expectNothingFetchedOrSaved();
  });

  it('SPEC-0014:IT-03 áudio criptografado já no resolve (faixa padrão): o candidato volta ENCRYPTED sem requisição de mídia', async () => {
    await serve({
      '/av/audio.m3u8': body(withKey(audio.playlist)),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'ENCRYPTED' });
    expectNothingFetchedOrSaved();
  });
});

describe('áudio indisponível, ao vivo ou inválido', () => {
  it('SPEC-0014:IT-04 playlist de áudio 404: HLS_NOT_RESOLVED, nunca vídeo mudo (sem mídia, sem downloads.download)', async () => {
    const state = await serve();
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.audio = (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    };

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expectNothingFetchedOrSaved();
  });

  it('SPEC-0014:IT-04 playlist de áudio ao vivo (sem EXT-X-ENDLIST): LIVE e nada baixado', async () => {
    const state = await serve();
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.audio = withoutEndlist(audio.playlist);

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'LIVE' });
    expectNothingFetchedOrSaved();
  });

  it('SPEC-0014:IT-04 playlist de áudio inválida (não é M3U8): HLS_NOT_RESOLVED e nada baixado', async () => {
    const state = await serve();
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.audio = '<html>não sou uma playlist</html>';

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expectNothingFetchedOrSaved();
  });

  it('SPEC-0014:IT-04 playlist de áudio sem segmentos (vazia): HLS_NOT_RESOLVED e nada baixado', async () => {
    const state = await serve();
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.audio = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-ENDLIST\n';

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expectNothingFetchedOrSaved();
  });

  it('SPEC-0014:IT-04 playlist de áudio cujo segmento não é http(s) (data:): HLS_NOT_RESOLVED e nada baixado', async () => {
    const state = await serve();
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.audio = audio.playlist.replaceAll('audio.mp4', 'data:audio/mp4;base64,AAAA');

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expectNothingFetchedOrSaved();
  });
});

describe('opções inválidas e trilhas que não são fMP4', () => {
  it('SPEC-0014:IT-05 audioIndex inexistente: UNSUPPORTED e nada baixado', async () => {
    await serve();
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const response = await startSplitDownload(bg, candidate.id, {
      variantIndex: 0,
      audioIndex: 99,
    });

    expect(response).toEqual({ ok: false, error: 'UNSUPPORTED' });
    expectNothingFetchedOrSaved();
  });

  it('SPEC-0014:IT-05 audioIndex de OUTRO grupo: UNSUPPORTED e nada baixado (e o índice do próprio grupo é aceito)', async () => {
    const master = masterOf(
      AUDIO_MEDIA('a1', 'English', 'audio.m3u8', { isDefault: true }),
      AUDIO_MEDIA('a2', 'Português', 'audio-pt.m3u8', { language: 'pt', isDefault: true }),
      STREAM('video.m3u8', 'a1', 300_000),
      STREAM('video-low.m3u8', 'a2', 100_000),
    );
    await serve({
      '/av/master.m3u8': body(master),
      '/av/audio-pt.m3u8': body(audio.playlist),
      '/av/video-low.m3u8': body(video.playlist),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));

    const refused = await startSplitDownload(bg, candidate.id, { variantIndex: 0, audioIndex: 1 });
    expect(refused).toEqual({ ok: false, error: 'UNSUPPORTED' });
    expectNothingFetchedOrSaved();

    const accepted = await startSplitDownload(bg, candidate.id, { variantIndex: 0, audioIndex: 0 });
    expect(accepted).toMatchObject({ ok: true });
  });

  it('SPEC-0014:IT-05 áudio em TS (sem EXT-X-MAP) com vídeo fMP4: aceito (SPEC-0019)', async () => {
    const state = await serve({
      '/av/a0.ts': body('x', 'video/mp2t'),
      '/av/a1.ts': body('x', 'video/mp2t'),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.audio = tsPlaylist('a');

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toMatchObject({ ok: true });
  });

  it('SPEC-0014:IT-05 vídeo em TS com áudio fMP4: UNSUPPORTED, sem requisição de mídia', async () => {
    const state = await serve({
      '/av/v0.ts': body('x', 'video/mp2t'),
      '/av/v1.ts': body('x', 'video/mp2t'),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.video = tsPlaylist('v');

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'UNSUPPORTED' });
    expectNothingFetchedOrSaved();
  });
});

/** Segmentos fMP4 (`.m4s`) SEM EXT-X-MAP: fMP4 sem init utilizável (revisão M3). */
const m4sPlaylist = (prefix: string): string =>
  [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:2',
    '#EXTINF:2.0,',
    `${prefix}0.m4s`,
    '#EXTINF:2.0,',
    `${prefix}1.m4s`,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

describe('fMP4 sem init (EXT-X-MAP) utilizável', () => {
  it('SPEC-0014:IT-05 áudio fMP4 (.m4s) sem EXT-X-MAP: HLS_NOT_RESOLVED antes de criar o job, sem requisição de mídia', async () => {
    const state = await serve({
      '/av/a0.m4s': body('x', 'video/iso.segment'),
      '/av/a1.m4s': body('x', 'video/iso.segment'),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.audio = m4sPlaylist('a');

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expectNothingFetchedOrSaved();
  });

  it('SPEC-0014:IT-05 vídeo fMP4 (.m4s) sem EXT-X-MAP com áudio fMP4: HLS_NOT_RESOLVED, sem requisição de mídia', async () => {
    const state = await serve({
      '/av/v0.m4s': body('x', 'video/iso.segment'),
      '/av/v1.m4s': body('x', 'video/iso.segment'),
    });
    const { candidate } = await observeAndResolve(bg, o('/av/master.m3u8'));
    state.video = m4sPlaylist('v');

    const response = await startSplitDownload(bg, candidate.id);

    expect(response).toEqual({ ok: false, error: 'HLS_NOT_RESOLVED' });
    expectNothingFetchedOrSaved();
  });
});
