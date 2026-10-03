/**
 * Contrato usado (SPEC-0015 §5/§6, IT-01) — `resolveHls` da master com buscas extras CONDICIONADAS, com
 * background real + fakeBrowser + servidor HTTP local real:
 *  - SEM candidato `file`/`hls` (que não seja a própria master) da MESMA origem na aba: nenhuma busca extra
 *    (só as da SPEC-0014: master, melhor variante, playlist de áudio padrão do grupo dele);
 *  - COM: busca também as demais playlists de variante (<= 4 no total) e de áudio (<= 4 no total), em
 *    paralelo; `hls.mediaResources` (origem+caminho dos arquivos citados por elas) volta preenchido;
 *  - falha numa busca extra (404, conexão derrubada, texto inválido) NÃO falha o resolve: o recurso dessa
 *    playlist só fica de fora de `mediaResources`;
 *  - nenhuma requisição de MÍDIA.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { detectCandidate } from './support/hls-job';
import { body, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';
import { COURSE, courseRoutes, observeTab, playlistPaths, slow } from './support/related-sources';
import type { CourseOptions } from './support/related-sources';
import { mediaLog } from './support/split-av';
import type { HlsInfo } from '../../src/core/hls';

let bg: BackgroundHarness;
let server: PlaylistServer;
const o = (path: string): string => `${server.origin}${COURSE}/${path}`;
const MASTER = '/c/master.m3u8';

beforeEach(() => {
  bg = startBackground();
});
afterEach(async () => {
  await server.close();
});

async function serve(options: CourseOptions, extra: Record<string, Handler> = {}) {
  server = await startPlaylistServer(courseRoutes(options, extra));
}

async function resolve(
  candidateId: string,
): Promise<{ ok: boolean; hls?: HlsInfo; error?: string }> {
  return (await bg.send({ type: 'resolveHls', candidateId })) as {
    ok: boolean;
    hls?: HlsInfo;
    error?: string;
  };
}

const sorted = (items: string[] | undefined): string[] => [...(items ?? [])].sort();
const resources = (...names: string[]): string[] => names.map((n) => o(n)).sort();
const notExtra = (path: string): string => path.slice(COURSE.length + 1);

describe('resolveHls: buscas extras só quando há candidatos relacionáveis', () => {
  it('SPEC-0015:IT-01 (guarda) aba só com a master: nenhuma busca extra (master + melhor variante + áudio padrão), zero mídia', async () => {
    await serve({ variants: 3, audio: 2 });
    const { master } = await observeTab(bg, `${server.origin}${MASTER}`);

    const response = await resolve(master.id);

    expect(response).toMatchObject({ ok: true });
    expect(playlistPaths(server).map(notExtra).sort()).toEqual([
      'a0.m3u8',
      'master.m3u8',
      'v0.m3u8',
    ]);
    expect(mediaLog(server)).toEqual([]);
  });

  it('SPEC-0015:IT-01 (guarda) só candidatos de OUTRA origem na aba: continua sem busca extra', async () => {
    await serve({ variants: 3, audio: 2 });
    const { master } = await observeTab(bg, `${server.origin}${MASTER}`, [
      'https://outra-origem.example.test/c/v1.mp4',
      'https://outra-origem.example.test/c/v2.m3u8',
    ]);

    await resolve(master.id);

    expect(playlistPaths(server).map(notExtra).sort()).toEqual([
      'a0.m3u8',
      'master.m3u8',
      'v0.m3u8',
    ]);
  });

  it('SPEC-0015:IT-01 com um .mp4 da mesma origem na aba: busca TODAS as playlists (3 variantes + 2 áudios) e preenche mediaResources', async () => {
    await serve({ variants: 3, audio: 2 });
    const { master } = await observeTab(bg, `${server.origin}${MASTER}`, [o('v0.mp4')]);

    const response = await resolve(master.id);

    expect(response).toMatchObject({ ok: true });
    expect(new Set(playlistPaths(server).map(notExtra))).toEqual(
      new Set(['master.m3u8', 'v0.m3u8', 'v1.m3u8', 'v2.m3u8', 'a0.m3u8', 'a1.m3u8']),
    );
    expect(playlistPaths(server).length).toBeLessThanOrEqual(6);
    expect(sorted(response.hls?.mediaResources)).toEqual(
      resources('v0.mp4', 'v1.mp4', 'v2.mp4', 'a0.mp4', 'a1.mp4'),
    );
    expect(mediaLog(server)).toEqual([]);
  });

  it('SPEC-0015:IT-01 um candidato HLS (não-master) da mesma origem também libera as buscas extras', async () => {
    await serve({ variants: 2, audio: 2 });
    const { master } = await observeTab(bg, `${server.origin}${MASTER}`, [o('v1.m3u8')]);

    const response = await resolve(master.id);

    expect(new Set(playlistPaths(server).map(notExtra))).toEqual(
      new Set(['master.m3u8', 'v0.m3u8', 'v1.m3u8', 'a0.m3u8', 'a1.m3u8']),
    );
    expect(response.hls?.mediaResources).toBeDefined();
    expect(response.hls?.mediaResources?.length).toBe(4);
  });

  it('SPEC-0015:IT-01 o resultado volta também pelo detect: o candidato guardado tem o mesmo mediaResources', async () => {
    await serve({ variants: 2, audio: 1 });
    const { master, tabId } = await observeTab(bg, `${server.origin}${MASTER}`, [o('v0.mp4')]);

    const response = await resolve(master.id);
    const after = await detectCandidate(bg, tabId, master.mediaUrl);

    expect(response.hls?.mediaResources).toBeDefined();
    expect(response.hls?.mediaResources?.length).toBeGreaterThan(0);
    expect(after.hls?.mediaResources).toEqual(response.hls?.mediaResources);
  });

  it('SPEC-0015:IT-01 limites: master com 6 variantes e 6 áudios busca no máximo 4 playlists de variante e 4 de áudio (a melhor variante e o áudio padrão entre elas)', async () => {
    await serve({ variants: 6, audio: 6 });
    const { master } = await observeTab(bg, `${server.origin}${MASTER}`, [o('v5.mp4')]);

    const response = await resolve(master.id);

    expect(response).toMatchObject({ ok: true });
    const fetched = new Set(playlistPaths(server).map(notExtra));
    const variants = [...fetched].filter((p) => p.startsWith('v'));
    const audios = [...fetched].filter((p) => p.startsWith('a'));
    // Há 6 de cada: a busca vai até o teto de 4 e não passa dele.
    expect(variants).toHaveLength(4);
    expect(audios).toHaveLength(4);
    expect(response.hls?.mediaResources).toBeDefined();
    expect(variants).toContain('v0.m3u8');
    expect(audios).toContain('a0.m3u8');
    expect(playlistPaths(server).length).toBeLessThanOrEqual(1 + 4 + 4);
    // A 5ª e a 6ª variante/áudio nunca foram buscadas, e seus arquivos não entram em mediaResources.
    for (const never of ['v4.m3u8', 'v5.m3u8', 'a4.m3u8', 'a5.m3u8']) {
      expect(fetched.has(never), never).toBe(false);
    }
    expect(response.hls?.mediaResources).not.toContain(o('v5.mp4'));
    expect(response.hls?.mediaResources?.length).toBeLessThanOrEqual(8);
  });

  it('SPEC-0015:IT-01 as buscas extras rodam em PARALELO (várias playlists em voo ao mesmo tempo)', async () => {
    const counter = { inflight: 0, max: 0 };
    const base = courseRoutes({ variants: 3, audio: 2 });
    const delayed = Object.fromEntries(
      ['v1', 'v2', 'a1'].map((name) => {
        const key = `${COURSE}/${name}.m3u8`;
        return [key, slow(150, base[key] as Handler, counter)];
      }),
    );
    await serve({ variants: 3, audio: 2 }, delayed);
    const { master } = await observeTab(bg, `${server.origin}${MASTER}`, [o('v0.mp4')]);

    await resolve(master.id);

    expect(counter.max).toBeGreaterThanOrEqual(3);
  });
});

describe('resolveHls: falha numa busca extra não derruba o resolve', () => {
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
    it(`SPEC-0015:IT-01 playlist extra de variante e de áudio com ${label}: resolve ok; só os recursos delas ficam de fora`, async () => {
      await serve(
        { variants: 3, audio: 3 },
        { [`${COURSE}/v1.m3u8`]: handler, [`${COURSE}/a2.m3u8`]: handler },
      );
      const { master } = await observeTab(bg, `${server.origin}${MASTER}`, [o('v0.mp4')]);

      const response = await resolve(master.id);

      expect(response).toMatchObject({ ok: true });
      expect(response.hls).toMatchObject({ type: 'master', encrypted: false, live: false });
      expect(sorted(response.hls?.mediaResources)).toEqual(
        resources('v0.mp4', 'v2.mp4', 'a0.mp4', 'a1.mp4'),
      );
    });
  }

  it('SPEC-0015:IT-01 todas as extras falham: resolve ok, mediaResources só com o que a melhor variante e o áudio padrão citam (ou ausente), sem erro', async () => {
    const notFound: Handler = (_req, res) => {
      res.writeHead(404).end('nf');
    };
    await serve(
      { variants: 3, audio: 3 },
      Object.fromEntries(['v1', 'v2', 'a1', 'a2'].map((n) => [`${COURSE}/${n}.m3u8`, notFound])),
    );
    const { master } = await observeTab(bg, `${server.origin}${MASTER}`, [o('v0.mp4')]);

    const response = await resolve(master.id);

    expect(response).toMatchObject({ ok: true });
    expect(response.hls?.mediaResources ?? []).not.toContain(o('v1.mp4'));
    expect(response.hls?.mediaResources ?? []).not.toContain(o('a1.mp4'));
    // O recurso de uma playlist extra que funcionou continua preenchido (a melhor variante).
    expect(response.hls?.mediaResources).toBeDefined();
    expect(response.hls?.mediaResources).toContain(o('v0.mp4'));
  });
});
