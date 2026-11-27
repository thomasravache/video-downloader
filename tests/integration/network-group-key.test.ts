/**
 * Contrato usado (SPEC-0024:IT-06), background real + fakeBrowser + servidor HTTP local real:
 *  - dois masters no MESMO caminho com `id` diferente na query (`/hls/playlist.m3u8?id=A` e `?id=B`), capturados
 *    pela rede na mesma aba, saem do `detect` como dois candidatos;
 *  - depois de resolver o master A (`resolveHls`), cujas variantes usam o mesmo caminho com outra query
 *    (`playlist.m3u8?id=A&rendition=720`), `groupCandidates` (o que o popup desenha) mantém os dois como cartões
 *    próprios: B não vira "fonte redundante" de A (chave de agrupamento = `groupKey`, D9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupCandidates } from '../../src/core/candidates';
import type { DetectResponse, VideoCandidate } from '../../src/core/contracts';
import { injected, page, startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import { HLS_TYPE, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';

const PAGE = 'https://site.example.test/aula';
const HLS_HEADERS = { 'Content-Type': HLS_TYPE, 'Content-Length': '700' };

const masterFor = (id: string) =>
  `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720\nplaylist.m3u8?id=${id}&rendition=720\n`;
const MEDIA =
  '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:4.0,\nseg0.ts\n#EXTINF:4.0,\nseg1.ts\n#EXT-X-ENDLIST\n';

let bg: BackgroundHarness;
let server: PlaylistServer;

beforeEach(async () => {
  bg = startBackground();
  server = await startPlaylistServer({
    // Mesmo caminho para master e variante: a query decide o que é servido (como na plataforma relatada).
    '/hls/playlist.m3u8': (req, res) => {
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
      const text = query.has('rendition') ? MEDIA : masterFor(query.get('id') ?? '');
      res.writeHead(200, { 'content-type': HLS_TYPE, 'content-length': Buffer.byteLength(text) });
      res.end(text);
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

async function detectTab(tabId: number): Promise<VideoCandidate[]> {
  bg.executeScript.mockResolvedValue([injected({ frameId: 0, snapshot: page([]) })]);
  const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;
  if (!response.ok) {
    throw new Error(`detect falhou: ${JSON.stringify(response)}`);
  }
  return response.candidates;
}

describe('aulas distintas no mesmo caminho (D9)', () => {
  it('SPEC-0024:IT-06 dois masters com o mesmo caminho e id diferente: o detect devolve dois candidatos que não são agrupados como redundantes', async () => {
    const a = `${server.origin}/hls/playlist.m3u8?id=A`;
    const b = `${server.origin}/hls/playlist.m3u8?id=B`;
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: a, tabId, headers: HLS_HEADERS });
    await bg.network.respond({ url: b, tabId, headers: HLS_HEADERS });

    const first = await detectTab(tabId);
    expect(first.map((c) => c.mediaUrl).sort()).toEqual([a, b].sort());
    const masterA = first.find((c) => c.mediaUrl === a);
    const resolved = (await bg.send({ type: 'resolveHls', candidateId: masterA?.id })) as {
      ok: boolean;
    };
    expect(resolved, JSON.stringify(resolved)).toMatchObject({ ok: true });

    const candidates = await detectTab(tabId);
    const groups = groupCandidates(candidates);

    expect(candidates.map((c) => c.mediaUrl).sort()).toEqual([a, b].sort());
    expect(groups.map((g) => g.primary.mediaUrl).sort()).toEqual([a, b].sort());
    expect(groups.every((g) => g.related.length === 0)).toBe(true);
  });
});
