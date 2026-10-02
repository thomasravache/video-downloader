/**
 * Contrato usado (SPEC-0011:IT-01, IT-03), background real + fakeBrowser + servidor HTTP local real:
 *  - mensagem {type:'resolveHls', candidateId} (a própria extensão) ->
 *      { ok: true, hls: HlsInfo }
 *    | { ok: false, error: 'CANDIDATE_NOT_FOUND' | 'HLS_FETCH_FAILED' | 'HLS_PARSE_FAILED' };
 *  - o candidato é um `kind: 'hls'` observado pela rede (webRequest) e listado por `detect`;
 *  - o background usa o PlaylistFetcherPort real (entrypoints/background/playlist-fetcher) com o `fetch`
 *    global: aqui ele fala com o servidor local, que registra cada requisição recebida;
 *  - master: busca o master e SÓ a playlist da melhor variante (maior banda); encrypted/live/duração/
 *    segmentos do resultado refletem essa playlist (encrypted também se o master tem SESSION-KEY);
 *  - nenhuma URL do conteúdo além da variante (segmentos, chaves) é requisitada;
 *  - o diagnóstico (mensagem 'diagnostics') nunca contém query strings (ADR-0009).
 * Timeout/limites do fetcher: tests/integration/hls-fetcher.test.ts (SPEC-0011:IT-02).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injected, page, startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { HLS_TYPE, body, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';
import type { DetectResponse, VideoCandidate } from '../../src/core/contracts';

const PAGE = 'https://site.example.test/aula';
const HLS_HEADERS = { 'Content-Type': HLS_TYPE, 'Content-Length': '700' };

/** Master com as variantes FORA de ordem de banda: a melhor (1080p) é a do meio. */
const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720
v720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080
v1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480
v480.m3u8
`;

function media(extinfs: number[], { key = '', endlist = true } = {}): string {
  const segments = extinfs.map((d, i) => `#EXTINF:${d.toFixed(1)},\nseg${String(i)}.ts`).join('\n');
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n${key}\n${segments}\n${endlist ? '#EXT-X-ENDLIST' : ''}\n`;
}

const masterOf = (variant: string, header = ''): string =>
  `#EXTM3U\n${header}#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080\n${variant}\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480\nlow.m3u8\n`;

let bg: BackgroundHarness;
let server: PlaylistServer;

beforeEach(async () => {
  bg = startBackground();
  server = await startPlaylistServer({
    '/hls/master.m3u8': body(MASTER),
    // 1080p: 4 + 4 + 2,5 = 10,5 s, 3 segmentos. As demais têm durações bem diferentes.
    '/hls/v1080.m3u8': body(media([4, 4, 2.5])),
    '/hls/v720.m3u8': body(media([99, 99])),
    '/hls/v480.m3u8': body(media([77])),
    '/hls/low.m3u8': body(media([77])),
    '/hls/media.m3u8': body(media([6, 6, 6, 6])),
    '/hls/enc-master.m3u8': body(masterOf('enc/v1080.m3u8')),
    '/hls/enc/v1080.m3u8': body(media([4, 4], { key: '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"' })),
    '/hls/live-master.m3u8': body(masterOf('live/v1080.m3u8')),
    '/hls/live/v1080.m3u8': body(media([4, 4, 4], { endlist: false })),
    '/hls/session-master.m3u8': body(
      masterOf('v1080.m3u8', '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"\n'),
    ),
    '/hls/html.m3u8': body('<!doctype html><html><body>Erro</body></html>', 'text/html'),
    '/hls/empty.m3u8': body(''),
    '/hls/bad-variant-master.m3u8': body(masterOf('html.m3u8')),
    '/hls/dead-variant-master.m3u8': body(masterOf('gone/v1080.m3u8')),
    '/hls/drop.m3u8': (req) => {
      req.socket.destroy();
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

/** Observa `url` como resposta HLS da aba e devolve o candidato listado por `detect`. */
async function observe(url: string, tabId?: number): Promise<VideoCandidate> {
  const tab = tabId ?? (await bg.newTab(PAGE));
  await bg.network.respond({ url, tabId: tab, headers: HLS_HEADERS });
  bg.executeScript.mockResolvedValue([injected({ frameId: 0, snapshot: page([]) })]);
  const response = (await bg.send({ type: 'detect', tabId: tab })) as DetectResponse;
  if (!response.ok) {
    throw new Error(`detect falhou: ${JSON.stringify(response)}`);
  }
  const found = response.candidates.find((c) => c.mediaUrl === url);
  if (!found) {
    throw new Error(`candidato ${url} ausente: ${JSON.stringify(response.candidates)}`);
  }
  return found;
}

const resolve = (candidateId: string) => bg.send({ type: 'resolveHls', candidateId });

describe('resolveHls: leitura da playlist HLS no background', () => {
  it('SPEC-0011:IT-01 master: devolve HlsInfo com 3 variantes por banda decrescente e dados da melhor variante', async () => {
    const candidate = await observe(`${server.origin}/hls/master.m3u8`);

    const response = await resolve(candidate.id);

    expect(response).toMatchObject({
      ok: true,
      hls: { type: 'master', encrypted: false, live: false, segmentCount: 3 },
    });
    const { hls } = response as {
      hls: { variants: { label: string; url: string }[]; durationSec: number };
    };
    expect(hls.variants.map((v) => v.label)).toEqual(['1080p', '720p', '480p']);
    expect(hls.variants[0]?.url).toBe(`${server.origin}/hls/v1080.m3u8`);
    expect(hls.durationSec).toBeCloseTo(10.5, 5);
  });

  it('SPEC-0011:IT-01 master: busca o master e só a playlist da melhor variante (nenhuma outra variante, segmento ou chave)', async () => {
    const candidate = await observe(`${server.origin}/hls/master.m3u8`);

    await resolve(candidate.id);

    expect(server.requests).toEqual(['/hls/master.m3u8', '/hls/v1080.m3u8']);
  });

  it('SPEC-0011:IT-01 playlist de mídia direta: tipo media, duração e segmentos, uma só requisição', async () => {
    const candidate = await observe(`${server.origin}/hls/media.m3u8`);

    const response = await resolve(candidate.id);

    expect(response).toMatchObject({
      ok: true,
      hls: { type: 'media', variants: [], segmentCount: 4, durationSec: 24, live: false },
    });
    expect(server.requests).toEqual(['/hls/media.m3u8']);
  });

  it('SPEC-0011:IT-01 master limpo com variante AES-128: encrypted vem da variante', async () => {
    const candidate = await observe(`${server.origin}/hls/enc-master.m3u8`);

    const response = await resolve(candidate.id);

    expect(response).toMatchObject({ ok: true, hls: { type: 'master', encrypted: true } });
    expect(server.requests).toEqual(['/hls/enc-master.m3u8', '/hls/enc/v1080.m3u8']);
  });

  it('SPEC-0011:IT-01 master com variante sem ENDLIST: live vem da variante', async () => {
    const candidate = await observe(`${server.origin}/hls/live-master.m3u8`);

    const response = await resolve(candidate.id);

    expect(response).toMatchObject({
      ok: true,
      hls: { type: 'master', live: true, encrypted: false },
    });
  });

  it('SPEC-0011:IT-01 master com EXT-X-SESSION-KEY: encrypted mesmo com variante sem chave', async () => {
    const candidate = await observe(`${server.origin}/hls/session-master.m3u8`);

    const response = await resolve(candidate.id);

    expect(response).toMatchObject({ ok: true, hls: { type: 'master', encrypted: true } });
  });

  it('SPEC-0011:IT-01 conteúdo inválido (HTML ou vazio) responde HLS_PARSE_FAILED', async () => {
    const html = await observe(`${server.origin}/hls/html.m3u8`);
    const empty = await observe(`${server.origin}/hls/empty.m3u8`);

    expect(await resolve(html.id)).toEqual({ ok: false, error: 'HLS_PARSE_FAILED' });
    expect(await resolve(empty.id)).toEqual({ ok: false, error: 'HLS_PARSE_FAILED' });
  });

  it('SPEC-0011:IT-01 master cuja melhor variante é inválida responde HLS_PARSE_FAILED', async () => {
    const candidate = await observe(`${server.origin}/hls/bad-variant-master.m3u8`);

    expect(await resolve(candidate.id)).toEqual({ ok: false, error: 'HLS_PARSE_FAILED' });
  });

  it('SPEC-0011:IT-01 404 e conexão derrubada respondem HLS_FETCH_FAILED', async () => {
    const missing = await observe(`${server.origin}/hls/missing.m3u8`);
    const dropped = await observe(`${server.origin}/hls/drop.m3u8`);

    expect(await resolve(missing.id)).toEqual({ ok: false, error: 'HLS_FETCH_FAILED' });
    expect(await resolve(dropped.id)).toEqual({ ok: false, error: 'HLS_FETCH_FAILED' });
  });

  it('SPEC-0011:IT-01 master cuja melhor variante dá 404 responde HLS_FETCH_FAILED', async () => {
    const candidate = await observe(`${server.origin}/hls/dead-variant-master.m3u8`);

    expect(await resolve(candidate.id)).toEqual({ ok: false, error: 'HLS_FETCH_FAILED' });
  });

  it('SPEC-0011:IT-01 servidor inalcançável responde HLS_FETCH_FAILED', async () => {
    const candidate = await observe(`${server.origin}/hls/master.m3u8`);
    await server.close();

    expect(await resolve(candidate.id)).toEqual({ ok: false, error: 'HLS_FETCH_FAILED' });
  });

  it('SPEC-0011:IT-01 id de candidato desconhecido responde CANDIDATE_NOT_FOUND e nada é requisitado', async () => {
    expect(await resolve('ffffffffffffffff')).toEqual({ ok: false, error: 'CANDIDATE_NOT_FOUND' });
    expect(server.requests).toEqual([]);
  });

  it('SPEC-0011:IT-01 uma falha não trava o background: depois do erro, outra playlist resolve normalmente', async () => {
    const bad = await observe(`${server.origin}/hls/html.m3u8`);
    const good = await observe(`${server.origin}/hls/media.m3u8`);

    expect(await resolve(bad.id)).toEqual({ ok: false, error: 'HLS_PARSE_FAILED' });
    expect(await resolve(good.id)).toMatchObject({ ok: true, hls: { type: 'media' } });
  });
});

describe('resolveHls: privacidade (NFR)', () => {
  const TOKEN_MASTER = '/hls/token-master.m3u8';

  it('SPEC-0011:IT-03 com ?token=... nas URLs, o diagnóstico não contém token= e o servidor só recebe as playlists', async () => {
    await server.close();
    server = await startPlaylistServer({
      [TOKEN_MASTER]: (_req, res) => {
        const text = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080\nhttp://${String(
          res.req.headers.host,
        )}/hls/tv1080.m3u8?token=var789\n#EXT-X-STREAM-INF:BANDWIDTH=800000\ntv480.m3u8?token=low456\n`;
        body(text)(_req, res);
      },
      '/hls/tv1080.m3u8': body(media([4, 4])),
      '/hls/missing.m3u8': (_req, res) => {
        res.writeHead(404).end('nope');
      },
    });
    const tabId = await bg.newTab(`${PAGE}?token=pagina`);
    const ok = await observe(`${server.origin}${TOKEN_MASTER}?token=abc123`, tabId);
    const missing = await observe(`${server.origin}/hls/missing.m3u8?token=zzz999`, tabId);

    const resolved = await resolve(ok.id);
    const failed = await resolve(missing.id);
    const diagnostics = (await bg.send({ type: 'diagnostics' })) as {
      ok: boolean;
      entries: Record<string, unknown>[];
    };

    expect(resolved).toMatchObject({ ok: true, hls: { type: 'master' } });
    expect(failed).toEqual({ ok: false, error: 'HLS_FETCH_FAILED' });
    expect(diagnostics.ok).toBe(true);
    const serialized = JSON.stringify(diagnostics.entries);
    for (const secret of ['token=', 'abc123', 'var789', 'low456', 'zzz999', 'pagina']) {
      expect(serialized, secret).not.toContain(secret);
    }
    for (const entry of diagnostics.entries) {
      expect(entry['correlationId'], JSON.stringify(entry)).toEqual(expect.any(String));
      expect(entry['correlationId']).not.toBe('');
    }
    // Só URLs de playlist: o master observado, a melhor variante e a playlist que deu 404; nenhum segmento, chave ou outra variante.
    expect(server.requests.sort()).toEqual(
      [
        `${TOKEN_MASTER}?token=abc123`,
        '/hls/tv1080.m3u8?token=var789',
        '/hls/missing.m3u8?token=zzz999',
      ].sort(),
    );
  });
});

describe('resolveHls: estado do candidato guardado (Emenda 1)', () => {
  /** Nova chamada de `detect` na mesma aba: devolve o candidato com o mesmo id. */
  async function detectAgain(candidate: VideoCandidate): Promise<VideoCandidate> {
    const tabId = candidate.tabId;
    bg.executeScript.mockResolvedValue([injected({ frameId: 0, snapshot: page([]) })]);
    const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;
    if (!response.ok) {
      throw new Error(`detect falhou: ${JSON.stringify(response)}`);
    }
    const found = response.candidates.find((c) => c.id === candidate.id);
    if (!found) {
      throw new Error(`candidato ${candidate.id} ausente: ${JSON.stringify(response.candidates)}`);
    }
    return found;
  }

  it('SPEC-0011:IT-04 playlist VOD limpa: detect devolve o mesmo candidato com hls resolvido e protection none', async () => {
    const candidate = await observe(`${server.origin}/hls/master.m3u8`);

    const response = await resolve(candidate.id);
    const again = await detectAgain(candidate);

    expect(response).toMatchObject({ ok: true });
    expect(again.id).toBe(candidate.id);
    expect(again.protection).toBe('none');
    expect(again.hls).toEqual((response as { hls: unknown }).hls);
    expect(again.hls).toMatchObject({ type: 'master', encrypted: false, live: false });
  });

  it('SPEC-0011:IT-04 playlist criptografada: o candidato passa a protection encrypted e deixa de ser baixável', async () => {
    const candidate = await observe(`${server.origin}/hls/enc-master.m3u8`);

    await resolve(candidate.id);
    const again = await detectAgain(candidate);

    expect(again.id).toBe(candidate.id);
    expect(again.hls).toMatchObject({ encrypted: true });
    expect(again.protection).toBe('encrypted');
    expect(again.support).not.toBe('downloadable');
  });

  it('SPEC-0011:IT-04 playlist ao vivo: o candidato passa a support unsupported-stream', async () => {
    const candidate = await observe(`${server.origin}/hls/live-master.m3u8`);

    await resolve(candidate.id);
    const again = await detectAgain(candidate);

    expect(again.id).toBe(candidate.id);
    expect(again.hls).toMatchObject({ live: true });
    expect(again.support).toBe('unsupported-stream');
  });

  it('SPEC-0011:IT-04 resolveHls com falha (404 ou parse) deixa o candidato inalterado, sem hls', async () => {
    const missing = await observe(`${server.origin}/hls/missing.m3u8`);
    const html = await observe(`${server.origin}/hls/html.m3u8`);

    expect(await resolve(missing.id)).toEqual({ ok: false, error: 'HLS_FETCH_FAILED' });
    expect(await resolve(html.id)).toEqual({ ok: false, error: 'HLS_PARSE_FAILED' });
    const missingAgain = await detectAgain(missing);
    const htmlAgain = await detectAgain(html);

    expect(missingAgain).toEqual(missing);
    expect(htmlAgain).toEqual(html);
    expect(missingAgain.hls).toBeUndefined();
    expect(htmlAgain.hls).toBeUndefined();
  });
});
