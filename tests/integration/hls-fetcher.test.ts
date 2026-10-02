/**
 * Contrato usado (SPEC-0011:IT-02), fetcher real contra um servidor HTTP local:
 *   entrypoints/background/playlist-fetcher ->
 *     createPlaylistFetcher(options?: { clock?: PlaylistClock }): PlaylistFetcherPort
 *     PlaylistFetchError (code 'HLS_FETCH_FAILED'); PlaylistClock = { setTimeout(handler, ms), clearTimeout(handle) }
 *   src/core/ports -> PlaylistFetcherPort { fetchPlaylist(url): Promise<string> } (resolve com o TEXTO;
 *     rejeita com PlaylistFetchError em qualquer recusa/falha)
 *   Limites (spec §6): 10 s (agendado no `clock` injetado; ao disparar, a requisição é abortada e a
 *   promessa rejeita), 1 MiB, ≤ 3 redirecionamentos, só http(s), só text/* ou
 *   application/(vnd.apple.mpegurl|x-mpegurl|octet-stream).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  PlaylistFetchError,
  createPlaylistFetcher,
} from '../../entrypoints/background/playlist-fetcher';
import type { PlaylistClock } from '../../entrypoints/background/playlist-fetcher';
import { HLS_TYPE, body, redirect, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';

const MIB = 1024 * 1024;
const PLAYLIST = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\ns.ts\n#EXT-X-ENDLIST\n';

let server: PlaylistServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Playlist válida preenchida com comentários até ter exatamente `bytes` bytes. */
function playlistOfSize(bytes: number): string {
  const pad = bytes - Buffer.byteLength(PLAYLIST);
  return PLAYLIST + `#${'x'.repeat(pad - 2)}\n`;
}

async function start(routes: Record<string, Handler>): Promise<PlaylistServer> {
  server = await startPlaylistServer(routes);
  return server;
}

async function refusal(promise: Promise<string>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('PlaylistFetcherPort real: limites de tamanho, tipo, redirecionamento e esquema', () => {
  it('SPEC-0011:IT-02 uma playlist pequena com content-type de HLS volta como texto', async () => {
    const s = await start({ '/p.m3u8': body(PLAYLIST) });

    await expect(createPlaylistFetcher().fetchPlaylist(`${s.origin}/p.m3u8`)).resolves.toBe(
      PLAYLIST,
    );
  });

  it('SPEC-0011:IT-02 aceita text/plain com charset, application/x-mpegurl e application/octet-stream', async () => {
    const s = await start({
      '/a': body(PLAYLIST, 'text/plain; charset=utf-8'),
      '/b': body(PLAYLIST, 'application/x-mpegURL'),
      '/c': body(PLAYLIST, 'application/octet-stream'),
    });
    const fetcher = createPlaylistFetcher();

    for (const path of ['/a', '/b', '/c']) {
      await expect(fetcher.fetchPlaylist(`${s.origin}${path}`), path).resolves.toBe(PLAYLIST);
    }
  });

  it('SPEC-0011:IT-02 a query da URL observada é enviada ao servidor', async () => {
    const s = await start({ '/p.m3u8': body(PLAYLIST) });

    await createPlaylistFetcher().fetchPlaylist(`${s.origin}/p.m3u8?token=abc123`);

    expect(s.requests).toEqual(['/p.m3u8?token=abc123']);
  });

  it('SPEC-0011:IT-02 corpo de exatamente 1 MiB é aceito', async () => {
    const text = playlistOfSize(MIB);
    const s = await start({ '/p.m3u8': body(text) });

    await expect(createPlaylistFetcher().fetchPlaylist(`${s.origin}/p.m3u8`)).resolves.toHaveLength(
      text.length,
    );
  });

  it('SPEC-0011:IT-02 corpo acima de 1 MiB com Content-Length é recusado', async () => {
    const s = await start({ '/big.m3u8': body(playlistOfSize(MIB + 1)) });

    const error = await refusal(createPlaylistFetcher().fetchPlaylist(`${s.origin}/big.m3u8`));

    expect(error).toBeInstanceOf(PlaylistFetchError);
  });

  it('SPEC-0011:IT-02 corpo acima de 1 MiB em chunked, sem Content-Length, é recusado', async () => {
    const chunk = 'x'.repeat(64 * 1024);
    const s = await start({
      '/stream.m3u8': (_req, res) => {
        res.writeHead(200, { 'content-type': HLS_TYPE });
        res.write(PLAYLIST);
        for (let i = 0; i < 20; i++) {
          res.write(`#${chunk}\n`);
        }
        res.end();
      },
    });

    const error = await refusal(createPlaylistFetcher().fetchPlaylist(`${s.origin}/stream.m3u8`));

    expect(error).toBeInstanceOf(PlaylistFetchError);
  });

  it('SPEC-0011:IT-02 tipos inesperados (json, mp4, imagem, mp2t) são recusados', async () => {
    const s = await start({
      '/j': body(PLAYLIST, 'application/json'),
      '/v': body(PLAYLIST, 'video/mp4'),
      '/i': body(PLAYLIST, 'image/png'),
      '/t': body(PLAYLIST, 'video/mp2t'),
    });
    const fetcher = createPlaylistFetcher();

    for (const path of ['/j', '/v', '/i', '/t']) {
      expect(await refusal(fetcher.fetchPlaylist(`${s.origin}${path}`)), path).toBeInstanceOf(
        PlaylistFetchError,
      );
    }
  });

  it('SPEC-0011:IT-02 status 404 e 500 rejeitam com PlaylistFetchError', async () => {
    const s = await start({
      '/err': (_req, res) => {
        res.writeHead(500, { 'content-type': HLS_TYPE }).end(PLAYLIST);
      },
    });
    const fetcher = createPlaylistFetcher();

    expect(await refusal(fetcher.fetchPlaylist(`${s.origin}/nada.m3u8`))).toBeInstanceOf(
      PlaylistFetchError,
    );
    expect(await refusal(fetcher.fetchPlaylist(`${s.origin}/err`))).toBeInstanceOf(
      PlaylistFetchError,
    );
  });

  it('SPEC-0011:IT-02 até 3 redirecionamentos são seguidos; o 4º é recusado', async () => {
    const s = await start({
      '/r1': redirect('/r2'),
      '/r2': redirect('/r3'),
      '/r3': redirect('/final.m3u8'),
      '/r4': redirect('/r1'),
      '/final.m3u8': body(PLAYLIST),
    });
    const fetcher = createPlaylistFetcher();

    await expect(fetcher.fetchPlaylist(`${s.origin}/r1`)).resolves.toBe(PLAYLIST);
    expect(await refusal(fetcher.fetchPlaylist(`${s.origin}/r4`))).toBeInstanceOf(
      PlaylistFetchError,
    );
  });

  it('SPEC-0011:IT-02 laço de redirecionamentos é recusado', async () => {
    const s = await start({ '/a': redirect('/b'), '/b': redirect('/a') });

    const error = await refusal(createPlaylistFetcher().fetchPlaylist(`${s.origin}/a`));

    expect(error).toBeInstanceOf(PlaylistFetchError);
  });

  it('SPEC-0011:IT-02 redirecionamento para esquema não http(s) é recusado', async () => {
    const s = await start({
      '/file': redirect('file:///etc/hosts'),
      '/ftp': redirect('ftp://127.0.0.1/p.m3u8'),
    });
    const fetcher = createPlaylistFetcher();

    expect(await refusal(fetcher.fetchPlaylist(`${s.origin}/file`))).toBeInstanceOf(
      PlaylistFetchError,
    );
    expect(await refusal(fetcher.fetchPlaylist(`${s.origin}/ftp`))).toBeInstanceOf(
      PlaylistFetchError,
    );
  });

  it('SPEC-0011:IT-02 URLs com esquema não http(s) são recusadas sem tocar o servidor', async () => {
    const s = await start({ '/p.m3u8': body(PLAYLIST) });
    const fetcher = createPlaylistFetcher();
    const urls = [
      'file:///etc/hosts',
      'ftp://127.0.0.1/p.m3u8',
      'data:application/vnd.apple.mpegurl,%23EXTM3U',
      'blob:http://127.0.0.1/abc',
      'javascript:alert(1)',
      'chrome-extension://abc/p.m3u8',
      'não é uma url',
    ];

    for (const url of urls) {
      expect(await refusal(fetcher.fetchPlaylist(url)), url).toBeInstanceOf(PlaylistFetchError);
    }
    expect(s.requests).toEqual([]);
  });

  it('SPEC-0011:IT-02 timeout de 10 s no relógio injetado aborta a requisição lenta e rejeita', async () => {
    const timers: { handler: () => void; ms: number }[] = [];
    const clock: PlaylistClock = {
      setTimeout: (handler, ms) => {
        timers.push({ handler, ms });
        return timers.length;
      },
      clearTimeout: () => undefined,
    };
    const s = await start({
      '/slow.m3u8': () => {
        // Nunca responde: só o timeout encerra a requisição.
      },
    });

    const pending = refusal(
      createPlaylistFetcher({ clock }).fetchPlaylist(`${s.origin}/slow.m3u8`),
    );
    await expect.poll(() => s.requests.length, { timeout: 5_000 }).toBe(1);
    expect(timers.map((t) => t.ms)).toContain(10_000);
    timers.find((t) => t.ms === 10_000)?.handler();

    expect(await pending).toBeInstanceOf(PlaylistFetchError);
  });
});
