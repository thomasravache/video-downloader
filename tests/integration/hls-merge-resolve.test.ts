/**
 * Contrato usado (SPEC-0014 §4/§6; estende SPEC-0011:IT-01) — `resolveHls` com background real + fakeBrowser +
 * servidor HTTP local real (fixtures de e2e/fixtures/hls/split-av):
 *  - master com áudio: busca a master, a playlist do MELHOR variante e UMA playlist extra: a de áudio PADRÃO
 *    (DEFAULT=YES, senão a primeira) do grupo desse variante; as demais faixas e grupos não são requisitados;
 *  - `HlsInfo.audio`/`variants[i].audioGroup` voltam preenchidos;
 *  - playlist de áudio padrão criptografada => `hls.encrypted = true` (candidato `encrypted`/`unsupported-stream`);
 *  - falha na busca extra (404, texto inválido, conexão derrubada) NÃO falha o resolve e não muda `encrypted`/`live`;
 *  - sem `AUDIO=` (ou grupo sem faixa com URI) nenhuma busca extra; nenhuma requisição de mídia.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { detectCandidate, observeHls } from './support/hls-job';
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
  withKey,
} from './support/split-av';
import type { HlsInfo } from '../../src/core/hls';

const video = splitTrack('video');
const audio = splitTrack('audio');

let bg: BackgroundHarness;
let server: PlaylistServer;
const o = (path: string): string => `${server.origin}${path}`;

beforeEach(() => {
  bg = startBackground();
});
afterEach(async () => {
  await server.close();
});

/** Duas faixas no grupo do melhor variante (a padrão é a 2ª) e uma no grupo do pior. */
const MASTER = masterOf(
  AUDIO_MEDIA('a1', 'English', 'audio-en.m3u8', { isDefault: true }),
  AUDIO_MEDIA('a2', 'Français', 'audio-fr.m3u8', { language: 'fr' }),
  AUDIO_MEDIA('a2', 'Português', 'audio-pt.m3u8', { language: 'pt', isDefault: true }),
  STREAM('video.m3u8', 'a2', 300_000),
  STREAM('video-low.m3u8', 'a1', 100_000),
);

async function serve(extra: Record<string, Handler> = {}): Promise<void> {
  server = await startPlaylistServer({
    ...splitRoutes('/av', { master: MASTER }),
    '/av/video-low.m3u8': body(video.playlist),
    '/av/audio-en.m3u8': body(audio.playlist),
    '/av/audio-fr.m3u8': body(audio.playlist),
    '/av/audio-pt.m3u8': body(audio.playlist),
    ...extra,
  });
}

async function resolve(url = '/av/master.m3u8') {
  const candidate = await observeHls(bg, o(url));
  const response = (await bg.send({ type: 'resolveHls', candidateId: candidate.id })) as {
    ok: boolean;
    hls?: HlsInfo;
    error?: string;
  };
  return { candidate, response };
}

describe('resolveHls com áudio separado', () => {
  it('SPEC-0014:IT-08 busca master + melhor variante + SÓ a playlist de áudio padrão do grupo dele (3 playlists, zero mídia)', async () => {
    await serve();

    const { response } = await resolve();

    expect(response).toMatchObject({ ok: true });
    expect(playlistLog(server).sort()).toEqual(
      ['/av/audio-pt.m3u8', '/av/master.m3u8', '/av/video.m3u8'].sort(),
    );
    expect(mediaLog(server)).toEqual([]);
  });

  it('SPEC-0014:IT-08 o HlsInfo traz audio (3 faixas, a DEFAULT do grupo marcada) e audioGroup em cada variante', async () => {
    await serve();

    const { response } = await resolve();

    const hls = response.hls as HlsInfo;
    expect(hls.variants.map((v) => v.audioGroup)).toEqual(['a2', 'a1']);
    expect(hls.audio?.map((t) => [t.groupId, t.name, t.default, t.url])).toEqual([
      ['a1', 'English', true, o('/av/audio-en.m3u8')],
      ['a2', 'Français', false, o('/av/audio-fr.m3u8')],
      ['a2', 'Português', true, o('/av/audio-pt.m3u8')],
    ]);
    expect(hls.encrypted).toBe(false);
    expect(hls.live).toBe(false);
  });

  it('SPEC-0014:IT-08 sem DEFAULT=YES no grupo, a playlist buscada é a da PRIMEIRA faixa do grupo', async () => {
    const master = masterOf(
      AUDIO_MEDIA('a1', 'English', 'audio-en.m3u8'),
      AUDIO_MEDIA('a1', 'Português', 'audio-pt.m3u8', { language: 'pt' }),
      STREAM('video.m3u8', 'a1'),
    );
    await serve({ '/av/master.m3u8': body(master) });

    await resolve();

    expect(playlistLog(server)).toContain('/av/audio-en.m3u8');
    expect(playlistLog(server)).not.toContain('/av/audio-pt.m3u8');
  });

  it('SPEC-0014:IT-08 áudio padrão criptografado: encrypted=true no resultado e o candidato fica ENCRYPTED/unsupported-stream', async () => {
    await serve({ '/av/audio-pt.m3u8': body(withKey(audio.playlist)) });

    const { candidate, response } = await resolve();

    expect(response).toMatchObject({ ok: true });
    expect(response.hls?.encrypted).toBe(true);
    expect(response.hls?.live).toBe(false);
    const after = await detectCandidate(bg, candidate.tabId, candidate.mediaUrl);
    expect(after).toMatchObject({ protection: 'encrypted', support: 'unsupported-stream' });
  });

  it('SPEC-0014:IT-08 só a faixa padrão conta no resolve: faixa NÃO padrão criptografada não marca encrypted', async () => {
    await serve({ '/av/audio-fr.m3u8': body(withKey(audio.playlist)) });

    const { response } = await resolve();

    expect(response.hls?.encrypted).toBe(false);
  });

  const FAILURES: [string, Handler][] = [
    [
      '404',
      (_req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      },
    ],
    ['texto inválido', body('<html>não é playlist</html>')],
    [
      'conexão derrubada',
      (req) => {
        req.socket.destroy();
      },
    ],
  ];
  for (const [label, handler] of FAILURES) {
    it(`SPEC-0014:IT-08 falha na busca extra do áudio (${label}): o resolve continua ok e encrypted/live não mudam`, async () => {
      await serve({ '/av/audio-pt.m3u8': handler });

      const { candidate, response } = await resolve();

      expect(response).toMatchObject({ ok: true });
      expect(response.hls).toMatchObject({ type: 'master', encrypted: false, live: false });
      expect(response.hls?.audio?.length).toBe(3);
      const after = await detectCandidate(bg, candidate.tabId, candidate.mediaUrl);
      expect(after).toMatchObject({ protection: 'none', support: 'downloadable' });
    });
  }

  it('SPEC-0014:IT-08 (guarda) master sem AUDIO= nas variantes: exatamente 2 playlists (master + variante), como na SPEC-0011', async () => {
    const master = masterOf(
      AUDIO_MEDIA('a1', 'English', 'audio-en.m3u8', { isDefault: true }),
      STREAM('video.m3u8'),
    );
    await serve({ '/av/master.m3u8': body(master) });

    const { response } = await resolve();

    expect(response).toMatchObject({ ok: true });
    expect(playlistLog(server).sort()).toEqual(['/av/master.m3u8', '/av/video.m3u8']);
  });

  it('SPEC-0014:IT-08 (guarda) grupo cujas faixas não têm URI (áudio embutido): nenhuma busca extra', async () => {
    const master = masterOf(
      AUDIO_MEDIA('a1', 'English', undefined, { isDefault: true }),
      STREAM('video.m3u8', 'a1'),
    );
    await serve({ '/av/master.m3u8': body(master) });

    const { response } = await resolve();

    expect(response).toMatchObject({ ok: true });
    expect(response.hls?.audio).toBeUndefined();
    expect(playlistLog(server).sort()).toEqual(['/av/master.m3u8', '/av/video.m3u8']);
  });

  it('SPEC-0019:IT-02 fluxo service.resolveHls sobre master playlist do YouTube com 18 variantes e 6 trilhas de áudio normaliza variantes com codec e indexa faixas de áudio', async () => {
    const audioLines = [
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="233",NAME="English",DEFAULT=YES,LANGUAGE="en",URI="audio-233-en.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="233",NAME="Português",LANGUAGE="pt",URI="audio-233-pt.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="English",DEFAULT=YES,LANGUAGE="en",URI="audio-234-en.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="Português",LANGUAGE="pt",URI="audio-234-pt.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="Español",LANGUAGE="es",URI="audio-234-es.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="234",NAME="Français",LANGUAGE="fr",URI="audio-234-fr.m3u8"',
    ];
    const resolutions = [
      { h: 2160, bwA: 15000000, bwV: 16000000, g: '234' },
      { h: 1440, bwA: 9000000, bwV: 9500000, g: '234' },
      { h: 1080, bwA: 4600000, bwV: 4800000, g: '234' },
      { h: 720, bwA: 2500000, bwV: 2600000, g: '234' },
      { h: 480, bwA: 1200000, bwV: 1300000, g: '234' },
      { h: 360, bwA: 700000, bwV: 750000, g: '233' },
      { h: 240, bwA: 400000, bwV: 420000, g: '233' },
      { h: 144, bwA: 200000, bwV: 220000, g: '233' },
      { h: 144, bwA: 100000, bwV: 110000, g: '233' }, // 9 resoluções * 2 codecs = 18 variantes
    ];
    const variantLines = resolutions.flatMap(({ h, bwA, bwV, g }, i) => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${String(bwV)},RESOLUTION=${String(Math.round((h * 16) / 9))}x${String(h)},CODECS="vp09.00.41.08",AUDIO="${g}"\nvideo-${String(i)}-vp9.m3u8`,
      `#EXT-X-STREAM-INF:BANDWIDTH=${String(bwA)},RESOLUTION=${String(Math.round((h * 16) / 9))}x${String(h)},CODECS="avc1.640028",AUDIO="${g}"\nvideo-${String(i)}-avc.m3u8`,
    ]);
    const ytMaster = ['#EXTM3U', '#EXT-X-VERSION:3', ...audioLines, ...variantLines].join('\n');

    const routes: Record<string, ReturnType<typeof body>> = {
      '/av/master-yt.m3u8': body(ytMaster),
      '/av/audio-234-en.m3u8': body(audio.playlist),
    };
    resolutions.forEach((_, i) => {
      routes[`/av/video-${String(i)}-vp9.m3u8`] = body(video.playlist);
      routes[`/av/video-${String(i)}-avc.m3u8`] = body(video.playlist);
    });
    await serve(routes);

    const { response } = await resolve('/av/master-yt.m3u8');
    expect(response).toMatchObject({ ok: true });
    if (!response.hls) throw new Error('esperado response.hls');
    const { hls } = response;
    expect(hls.type).toBe('master');
    expect(hls.variants).toHaveLength(18);
    expect(hls.audio).toHaveLength(6);
    expect(hls.audio?.map((a) => a.index)).toEqual([0, 1, 2, 3, 4, 5]);

    // Resoluções duplicadas devem priorizar AVC1 e enriquecer rótulos com codec
    const v1080 = hls.variants.filter((v) => v.height === 1080);
    expect(v1080).toHaveLength(2);
    expect(v1080[0]?.codecs).toContain('avc1');
    expect(v1080[0]?.label).toContain('(H.264)');
    expect(v1080[1]?.label).toContain('(VP9)');
  });
});
