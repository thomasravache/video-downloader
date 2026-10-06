/**
 * Contrato usado (SPEC-0016:IT-01, IT-03, IT-04 no resolve) — background REAL + fakeBrowser + servidor HTTP
 * local REAL + fake de `declarativeNetRequest` (tests/integration/support/dnr.ts: guarda as regras de sessão
 * e faz o `fetch` do Node aplicar o `modifyHeaders` de `origin`/`referer`):
 *  - o candidato HLS vem da rede com `initiator` (origem do frame do player) e `detect` o devolve com
 *    `initiatorOrigin`; `resolveHls` busca a playlist SEM contexto; se o servidor devolve 401/403 e o candidato
 *    tem `initiatorOrigin`, o background instala UMA regra de sessão (id 7_000_000+, `requestDomains` = hosts da
 *    operação, `initiatorDomains` = [id da extensão], `resourceTypes` = ['xmlhttprequest'], `set` de `origin` =
 *    initiatorOrigin e `referer` = initiatorOrigin + '/'), repete UMA vez e remove a regra;
 *  - sem `initiatorOrigin`, ou com outro status, nada é repetido e nenhuma regra é criada;
 *  - nenhum valor da mensagem do popup (origin/referer/hosts forjados) chega à regra; query e token nunca
 *    entram na regra nem nos logs (só host e origem).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBackground } from './support/background';
import type { BackgroundHarness } from './support/background';
import type { DnrHarness } from './support/dnr';
import {
  PLAYER,
  RESERVED_ID,
  expectAcceptedOnesCarriedContext,
  guarded,
  observeFrom,
  resolve,
  seenOn,
} from './support/context';
import { body, startPlaylistServer } from './support/playlist-server';
import type { PlaylistServer } from './support/playlist-server';

let bg: BackgroundHarness & { dnr: DnrHarness };
let server: PlaylistServer;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080
v1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480
v480.m3u8
`;
const media = (segment = 'seg0.ts'): string =>
  `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:4.0,\n${segment}\n#EXTINF:4.0,\nseg1.ts\n#EXT-X-ENDLIST\n`;

const o = (path: string): string => `${server.origin}${path}`;
const HOST = '127.0.0.1';

beforeEach(async () => {
  bg = startBackground({ dnr: true });
  server = await startPlaylistServer({
    ...guarded({
      '/hls/master.m3u8': body(MASTER),
      '/hls/v1080.m3u8': body(media()),
      '/hls/v480.m3u8': body(media()),
    }),
    '/open/master.m3u8': body(MASTER),
    '/open/v1080.m3u8': body(media()),
    '/open/v480.m3u8': body(media()),
    '/hls/expired.m3u8': (_req, res) => {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('expired');
    },
    '/hls/gone.m3u8': (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('gone');
    },
    '/hls/boom.m3u8': (_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('boom');
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

async function rulesGone(): Promise<void> {
  await vi.waitFor(() => {
    expect(bg.dnr.ids()).toEqual([]);
  });
}

describe('resolve com o contexto da página', () => {
  it('SPEC-0016:IT-01 o servidor recusa sem contexto: a 1ª busca é 403, a regra é instalada, a repetição resolve e a regra é removida', async () => {
    const candidate = await observeFrom(bg, o('/hls/master.m3u8'));
    expect(candidate.initiatorOrigin).toBe(PLAYER);

    const response = await resolve(bg, candidate.id);

    expect(response).toMatchObject({ ok: true, hls: { type: 'master', encrypted: false } });
    const master = seenOn(server, '/hls/master.m3u8');
    expect(master[0]).toMatchObject({ status: 403, origin: undefined, referer: undefined });
    expect(master.length).toBeLessThanOrEqual(2);
    expect(master.at(-1)).toMatchObject({ status: 200, origin: PLAYER, referer: `${PLAYER}/` });
    expect(seenOn(server, '/hls/v1080.m3u8').at(-1)).toMatchObject({ status: 200 });
    expectAcceptedOnesCarriedContext(server.log);
    await rulesGone();
  });

  it('SPEC-0016:IT-01 a regra instalada é exatamente a do contrato (hosts da operação, cabeçalhos origin/referer, só xmlhttprequest da extensão)', async () => {
    const candidate = await observeFrom(bg, o('/hls/master.m3u8'));

    await resolve(bg, candidate.id);

    const rules = bg.dnr.everAdded();
    expect(rules.length).toBeGreaterThanOrEqual(1);
    for (const rule of rules) {
      expect(rule.id).toBeGreaterThanOrEqual(RESERVED_ID);
      expect(rule).toEqual({
        id: rule.id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: PLAYER },
            { header: 'referer', operation: 'set', value: `${PLAYER}/` },
          ],
        },
        condition: {
          requestDomains: [HOST],
          initiatorDomains: [bg.ownId],
          resourceTypes: ['xmlhttprequest'],
        },
      });
    }
  });

  it('SPEC-0016:IT-01 a regra já está instalada quando a repetição sai (a 1ª busca não teve contexto, a 2ª sim)', async () => {
    const candidate = await observeFrom(bg, o('/hls/master.m3u8'));

    await resolve(bg, candidate.id);

    const masterFetches = bg.dnr.applied.filter((a) => a.url === o('/hls/master.m3u8'));
    expect(masterFetches[0]?.ruleIds).toEqual([]);
    expect(masterFetches[1]?.ruleIds.length).toBeGreaterThanOrEqual(1);
    expect(masterFetches.length).toBeLessThanOrEqual(2);
  });

  it('SPEC-0016:IT-01 nenhuma requisição leva Cookie (o contexto é só Origin/Referer)', async () => {
    const candidate = await observeFrom(bg, o('/hls/master.m3u8'));

    await resolve(bg, candidate.id);

    expect(server.log.some((r) => r.hasCookie)).toBe(false);
  });

  it('SPEC-0016:IT-01 (guarda) servidor que não exige contexto: resolve sem regra e sem repetir', async () => {
    const candidate = await observeFrom(bg, o('/open/master.m3u8'));

    expect(await resolve(bg, candidate.id)).toMatchObject({ ok: true });

    expect(bg.dnr.everAdded()).toEqual([]);
    expect(seenOn(server, '/open/master.m3u8')).toHaveLength(1);
    expect(seenOn(server, '/open/v1080.m3u8')).toHaveLength(1);
    expect(server.log.every((r) => r.origin === undefined && r.referer === undefined)).toBe(true);
  });

  it('SPEC-0016:IT-01 servidor que recusa mesmo com contexto: falha com status 403, no máximo 2 requisições e nenhuma regra sobra', async () => {
    const candidate = await observeFrom(bg, o('/hls/expired.m3u8'));

    expect(await resolve(bg, candidate.id)).toEqual({
      ok: false,
      error: 'HLS_FETCH_FAILED',
      status: 403,
    });

    expect(seenOn(server, '/hls/expired.m3u8')).toHaveLength(2);
    await rulesGone();
  });

  it('SPEC-0016:IT-01 404 e 500 não repetem nem criam regra e informam o status', async () => {
    for (const [path, status] of [
      ['/hls/gone.m3u8', 404],
      ['/hls/boom.m3u8', 500],
    ] as const) {
      const candidate = await observeFrom(bg, o(path));

      expect(await resolve(bg, candidate.id), path).toEqual({
        ok: false,
        error: 'HLS_FETCH_FAILED',
        status,
      });
      expect(seenOn(server, path), path).toHaveLength(1);
    }
    expect(bg.dnr.everAdded()).toEqual([]);
  });
});

describe('segurança do contexto no resolve', () => {
  it('SPEC-0016:IT-03 origin, referer e hosts forjados na mensagem do popup não chegam à regra nem ao servidor', async () => {
    const candidate = await observeFrom(bg, o('/hls/master.m3u8'));

    await bg.send({
      type: 'resolveHls',
      candidateId: candidate.id,
      origin: 'https://evil.test',
      referer: 'https://evil.test/roubo',
      hosts: ['evil.test'],
      initiatorOrigin: 'https://evil.test',
      headers: { origin: 'https://evil.test' },
    });

    expect(bg.dnr.everAdded().length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(bg.dnr.everAdded())).not.toContain('evil');
    expect(server.log.some((r) => `${r.origin ?? ''}${r.referer ?? ''}`.includes('evil'))).toBe(
      false,
    );
    for (const rule of bg.dnr.everAdded()) {
      expect(JSON.stringify(rule)).toContain(PLAYER);
    }
  });

  it('SPEC-0016:IT-03 candidato sem initiatorOrigin: 403 não repete e nenhuma regra é instalada', async () => {
    const candidate = await observeFrom(bg, o('/hls/master.m3u8'), null);
    expect(candidate).not.toHaveProperty('initiatorOrigin');

    expect(await resolve(bg, candidate.id)).toEqual({
      ok: false,
      error: 'HLS_FETCH_FAILED',
      status: 403,
    });

    expect(bg.dnr.everAdded()).toEqual([]);
    expect(bg.dnr.calls).toEqual([]);
    expect(seenOn(server, '/hls/master.m3u8')).toHaveLength(1);
  });

  it('SPEC-0016:IT-03 iniciador da própria extensão equivale a sem origem (sem regra, sem repetição)', async () => {
    const candidate = await observeFrom(
      bg,
      o('/hls/master.m3u8'),
      `chrome-extension://${bg.ownId}`,
    );

    expect(await resolve(bg, candidate.id)).toMatchObject({ ok: false, status: 403 });

    expect(bg.dnr.everAdded()).toEqual([]);
    expect(seenOn(server, '/hls/master.m3u8')).toHaveLength(1);
  });

  it('SPEC-0016:IT-03 host que só aparece no conteúdo (segmentos em outro host) não entra na regra do resolve', async () => {
    const port = new URL(server.origin).port;
    const elsewhere = `http://localhost:${port}/hls/outro.ts`;
    const other = await startPlaylistServer({
      ...guarded({
        '/hls/master.m3u8': body(MASTER),
        '/hls/v1080.m3u8': body(media(elsewhere)),
        '/hls/v480.m3u8': body(media(elsewhere)),
      }),
    });
    try {
      const candidate = await observeFrom(bg, `${other.origin}/hls/master.m3u8`);

      expect(await resolve(bg, candidate.id)).toMatchObject({ ok: true });

      const rules = bg.dnr.everAdded();
      expect(rules.length).toBeGreaterThanOrEqual(1);
      for (const rule of rules) {
        expect(rule.condition?.requestDomains).toEqual([HOST]);
      }
      expect(other.log.map((r) => r.url).some((u) => u.includes('outro.ts'))).toBe(false);
    } finally {
      await other.close();
    }
  });
});

describe('privacidade do contexto no resolve', () => {
  const TOKEN = 'SEGREDO-do-token-123';
  const QUERY = `?token=${TOKEN}&expires=1999999999`;

  it('SPEC-0016:IT-04 URLs com ?token=…&expires=… : a regra só tem host e origem (sem caminho, query nem token)', async () => {
    const candidate = await observeFrom(bg, o(`/hls/master.m3u8${QUERY}`));

    expect(await resolve(bg, candidate.id)).toMatchObject({ ok: true });

    const text = JSON.stringify(bg.dnr.everAdded());
    expect(bg.dnr.everAdded().length).toBeGreaterThanOrEqual(1);
    for (const forbidden of [
      TOKEN,
      'token',
      'expires',
      '1999999999',
      '?',
      'master.m3u8',
      '/hls/',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('SPEC-0016:IT-04 os logs registram "contexto usado" e o status, sem query/token e sem a origem completa', async () => {
    const candidate = await observeFrom(bg, o(`/hls/master.m3u8${QUERY}`));
    await resolve(bg, candidate.id);

    const { entries } = (await bg.send({ type: 'diagnostics' })) as {
      entries: { event: string }[];
    };

    const used = entries.filter((e) => e.event === 'hls.context_used');
    expect(used.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(used)).toContain('403');
    const text = JSON.stringify(entries);
    for (const forbidden of [TOKEN, 'expires=', 'token=', '1999999999', PLAYER]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
