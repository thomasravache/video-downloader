/**
 * Contrato usado (SPEC-0015 §5, IT-02, ADR-0009) — privacidade das buscas extras: URLs da master, das
 * playlists e dos arquivos de mídia com `?token=...&expires=...` (e fragmento) NUNCA aparecem em
 * `HlsInfo.mediaResources` (só origem+caminho), nos diagnósticos, no console nem em respostas de erro — quando
 * o resolve conclui, quando uma busca extra falha e quando a playlist principal falha.
 * Background real + fakeBrowser + servidor HTTP local real.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { body, startPlaylistServer } from './support/playlist-server';
import type { Handler, PlaylistServer } from './support/playlist-server';
import { COURSE, courseRoutes, mediaPlaylist, observeTab } from './support/related-sources';
import { captureConsole } from './support/split-av';
import type { HlsInfo } from '../../src/core/hls';

const SECRETS = ['token=', 'expires=', 'sig=', 'SEGREDO', 'frag'];
const QUERY = '?token=SEGREDO1&expires=111';

let bg: BackgroundHarness;
let server: PlaylistServer;
let logged: string[];
const o = (path: string): string => `${server.origin}${COURSE}/${path}`;

beforeEach(() => {
  bg = startBackground();
  logged = captureConsole();
});
afterEach(async () => {
  await server.close();
});

function expectClean(text: string, label: string): void {
  for (const secret of SECRETS) {
    expect(text, `${label}: contém "${secret}"`).not.toContain(secret);
  }
}

async function diagnosticsText(): Promise<string> {
  return JSON.stringify(await bg.send({ type: 'diagnostics' }));
}

const notFound: Handler = (_req, res) => {
  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
};

/** Playlists que citam a mídia com token e fragmento. */
const withFragment = (uri: string): Handler => body(mediaPlaylist(`${uri}${QUERY}#frag`));

describe('privacidade das buscas extras', () => {
  it('SPEC-0015:IT-02 mediaResources, resposta, candidato guardado, diagnósticos e console não têm o token (resolve concluído)', async () => {
    server = await startPlaylistServer(
      courseRoutes(
        { variants: 3, audio: 2, query: QUERY },
        {
          [`${COURSE}/v0.m3u8`]: withFragment('v0.mp4'),
          [`${COURSE}/v1.m3u8`]: withFragment('v1.mp4'),
        },
      ),
    );
    const { master, tabId } = await observeTab(bg, `${o('master.m3u8')}${QUERY}`, [
      `${o('v0.mp4')}${QUERY}`,
    ]);

    const response = (await bg.send({ type: 'resolveHls', candidateId: master.id })) as {
      ok: boolean;
      hls?: HlsInfo;
    };

    expect(response.ok).toBe(true);
    const resources = response.hls?.mediaResources;
    expect(resources).toBeDefined();
    expect(resources?.length).toBeGreaterThan(0);
    expect(resources).toContain(o('v0.mp4'));
    expect(resources).toContain(o('v1.mp4'));
    for (const item of resources ?? []) {
      expect(item).toMatch(/^https?:\/\/[^?#]+$/);
    }
    expectClean(JSON.stringify(resources), 'mediaResources');
    expectClean(await diagnosticsText(), 'diagnósticos');
    expectClean(logged.join('\n'), 'console');
    const stored = (await bg.send({ type: 'detect', tabId })) as {
      candidates: { hls?: HlsInfo }[];
    };
    const storedResources = stored.candidates.flatMap((c) => c.hls?.mediaResources ?? []);
    expect(storedResources.length).toBeGreaterThan(0);
    expectClean(JSON.stringify(storedResources), 'mediaResources guardado');
  });

  it('SPEC-0015:IT-02 playlists extras que falham (404, conexão derrubada): resolve ok e nenhum token em diagnósticos/console/mediaResources', async () => {
    server = await startPlaylistServer(
      courseRoutes(
        { variants: 3, audio: 3, query: QUERY },
        {
          [`${COURSE}/v0.m3u8`]: withFragment('v0.mp4'),
          [`${COURSE}/v1.m3u8`]: notFound,
          [`${COURSE}/a2.m3u8`]: (req) => {
            req.socket.destroy();
          },
        },
      ),
    );
    const { master } = await observeTab(bg, `${o('master.m3u8')}${QUERY}`, [
      `${o('v0.mp4')}${QUERY}`,
    ]);

    const response = (await bg.send({ type: 'resolveHls', candidateId: master.id })) as {
      ok: boolean;
      hls?: HlsInfo;
    };

    expect(response.ok).toBe(true);
    expect(response.hls?.mediaResources).toBeDefined();
    expect(response.hls?.mediaResources?.length).toBeGreaterThan(0);
    expectClean(JSON.stringify(response), 'resposta');
    expectClean(await diagnosticsText(), 'diagnósticos');
    expectClean(logged.join('\n'), 'console');
  });

  it('SPEC-0015:IT-02 a melhor variante falha (404): o erro devolvido e os diagnósticos não têm o token, mesmo com buscas extras habilitadas', async () => {
    server = await startPlaylistServer(
      courseRoutes({ variants: 3, audio: 2, query: QUERY }, { [`${COURSE}/v0.m3u8`]: notFound }),
    );
    const { master } = await observeTab(bg, `${o('master.m3u8')}${QUERY}`, [
      `${o('v1.mp4')}${QUERY}`,
    ]);

    const response = (await bg.send({ type: 'resolveHls', candidateId: master.id })) as {
      ok: boolean;
      error?: string;
      hls?: HlsInfo;
    };

    expect(response).toMatchObject({ ok: false, error: 'HLS_FETCH_FAILED' });
    expect(response.hls).toBeUndefined();
    expectClean(JSON.stringify(response), 'resposta de erro');
    expectClean(await diagnosticsText(), 'diagnósticos');
    expectClean(logged.join('\n'), 'console');
  });
});
