/**
 * Contrato usado (SPEC-0015 §5/§6, revisão): as buscas extras do resolve (variantes e áudios que só servem para
 * `mediaResources`) só vão a URLs da MESMA origem da master (cross-origin é ignorado em silêncio; a melhor
 * variante e o áudio padrão seguem como na SPEC-0014); e uma playlist extra CRIPTOGRAFADA ou AO VIVO nunca
 * muda `encrypted`/`live`/`protection` do candidato nem entra em `mediaResources`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { detectCandidate } from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import {
  COURSE,
  courseRoutes,
  mediaPlaylist,
  observeTab,
  playlistPaths,
} from './support/related-sources';
import { AUDIO_MEDIA, STREAM, masterOf } from './support/split-av';
import type { HlsInfo } from '../../src/core/hls';

let bg: BackgroundHarness;
let servers: PlaylistServer[] = [];
beforeEach(() => {
  bg = startBackground();
});
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function start(routes: Parameters<typeof startPlaylistServer>[0]): Promise<PlaylistServer> {
  const server = await startPlaylistServer(routes);
  servers.push(server);
  return server;
}
const resolve = async (id: string): Promise<{ ok: boolean; hls?: HlsInfo }> =>
  (await bg.send({ type: 'resolveHls', candidateId: id })) as { ok: boolean; hls?: HlsInfo };
const names = (server: PlaylistServer): Set<string> =>
  new Set(playlistPaths(server).map((p) => p.slice(COURSE.length + 1)));

describe('buscas extras: só da mesma origem da master', () => {
  it('SPEC-0015:IT-01 variantes e áudios extras de OUTRA origem não são buscados; os da mesma origem sim', async () => {
    const other = await start({
      [`${COURSE}/v1.m3u8`]: body(mediaPlaylist('v1.mp4')),
      [`${COURSE}/a1.m3u8`]: body(mediaPlaylist('a1.mp4')),
    });
    const home = await start({
      [`${COURSE}/master.m3u8`]: (req, res) => {
        const here = `http://${String(req.headers.host)}${COURSE}`;
        body(
          masterOf(
            AUDIO_MEDIA('a1', 'A0', 'a0.m3u8', { isDefault: true }),
            AUDIO_MEDIA('a1', 'A1', `${other.origin}${COURSE}/a1.m3u8`, { language: 'pt' }),
            AUDIO_MEDIA('a1', 'A2', 'a2.m3u8', { language: 'de' }),
            STREAM('v0.m3u8', 'a1', 900_000),
            STREAM(`${other.origin}${COURSE}/v1.m3u8`, 'a1', 800_000),
            STREAM(`${here}/v2.m3u8`, 'a1', 700_000),
          ),
        )(req, res);
      },
      ...Object.fromEntries(
        ['v0', 'v2', 'a0', 'a2'].map((n) => [
          `${COURSE}/${n}.m3u8`,
          body(mediaPlaylist(`${n}.mp4`)),
        ]),
      ),
    });
    const { master } = await observeTab(bg, `${home.origin}${COURSE}/master.m3u8`, [
      `${home.origin}${COURSE}/v0.mp4`,
    ]);

    const response = await resolve(master.id);

    expect(response.ok).toBe(true);
    expect(playlistPaths(other)).toEqual([]);
    expect(names(home)).toEqual(
      new Set(['master.m3u8', 'v0.m3u8', 'v2.m3u8', 'a0.m3u8', 'a2.m3u8']),
    );
    expect([...(response.hls?.mediaResources ?? [])].sort()).toEqual(
      ['v0', 'v2', 'a0', 'a2'].map((n) => `${home.origin}${COURSE}/${n}.mp4`).sort(),
    );
  });
});

describe('buscas extras criptografadas ou ao vivo', () => {
  const key = (uri: string): string =>
    mediaPlaylist(uri).replace('#EXT-X-MAP', '#EXT-X-KEY:METHOD=AES-128,URI="k.bin"\n#EXT-X-MAP');
  const live = (uri: string): string => mediaPlaylist(uri).replace('#EXT-X-ENDLIST\n', '');

  it('SPEC-0015:IT-01 extras criptografada e ao vivo: encrypted/live/protection do candidato seguem iguais e elas ficam fora de mediaResources', async () => {
    const server = await start(
      courseRoutes(
        { variants: 4, audio: 3 },
        {
          [`${COURSE}/v1.m3u8`]: body(key('v1.mp4')),
          [`${COURSE}/v2.m3u8`]: body(live('v2.mp4')),
          [`${COURSE}/a1.m3u8`]: body(key('a1.mp4')),
          [`${COURSE}/a2.m3u8`]: body(live('a2.mp4')),
        },
      ),
    );
    const { master, tabId } = await observeTab(bg, `${server.origin}${COURSE}/master.m3u8`, [
      `${server.origin}${COURSE}/v0.mp4`,
    ]);

    const response = await resolve(master.id);

    expect(response.ok).toBe(true);
    expect(response.hls).toMatchObject({ encrypted: false, live: false });
    const o = (n: string): string => `${server.origin}${COURSE}/${n}.mp4`;
    expect([...(response.hls?.mediaResources ?? [])].sort()).toEqual(
      [o('v0'), o('v3'), o('a0')].sort(),
    );
    const after = await detectCandidate(bg, tabId, master.mediaUrl);
    expect(after.protection).toBe('none');
    expect(after.support).toBe('downloadable');
    expect(after.hls).toMatchObject({ encrypted: false, live: false });
  });
});
