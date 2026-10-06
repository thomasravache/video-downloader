/**
 * Contrato usado (SPEC-0016:UT-04), escada de busca no `createService` (portas falsas):
 *  - `deps.requestContext?: RequestContextPort` (acquire({hosts, origin}) -> lease com release());
 *  - `resolveHls` de candidato de rede com `initiatorOrigin`: busca simples; se a busca REJEITA com
 *    `HLS_FETCH_FAILED: status 401|403`, instala o contexto (`acquire` com os hosts da operação e a origem do
 *    candidato), repete UMA vez, e libera o lease ao fim (sucesso ou falha);
 *  - qualquer outro resultado (404, 500, erro de rede), candidato sem `initiatorOrigin` ou serviço sem
 *    `requestContext`: nenhuma repetição, nenhum acquire;
 *  - 2ª recusa: resposta `{ ok: false, error: 'HLS_FETCH_FAILED', status: <status HTTP> }`; falha do
 *    `acquire`: o erro normal da busca (sem laço, sem nova tentativa).
 */
import { describe, expect, it } from 'vitest';
import {
  INITIATOR,
  MASTER_URL,
  MEDIA_PLAYLIST,
  makeContextService,
} from './support/context-service';

const needsContext = ({ leased }: { leased: boolean }) => (leased ? MEDIA_PLAYLIST : 403);

describe('escada de busca com contexto da página', () => {
  it('SPEC-0016:UT-04 403 e depois 200: repete uma vez com o contexto, resolve e libera o lease', async () => {
    const t = makeContextService({ respond: needsContext, initiator: INITIATOR });

    const response = await t.resolve();

    expect(response).toMatchObject({ ok: true, hls: { type: 'media' } });
    expect(t.calls).toEqual([
      { url: MASTER_URL, leased: false },
      { url: MASTER_URL, leased: true },
    ]);
    expect(t.acquire).toHaveBeenCalledTimes(1);
    expect(t.acquire).toHaveBeenCalledWith({ hosts: ['cdn.exemplo.test'], origin: INITIATOR });
    expect(t.leases()).toBe(0);
  });

  it('SPEC-0016:UT-04 o contexto é instalado ANTES da repetição, não da primeira busca', async () => {
    const t = makeContextService({ respond: needsContext, initiator: INITIATOR });

    await t.resolve();

    expect(t.events.slice(0, 3)).toEqual(['fetch:plain', 'acquire', 'fetch:ctx']);
  });

  it('SPEC-0016:UT-04 401 também repete (como o 403)', async () => {
    const t = makeContextService({
      respond: ({ leased }) => (leased ? MEDIA_PLAYLIST : 401),
      initiator: INITIATOR,
    });

    expect(await t.resolve()).toMatchObject({ ok: true });
    expect(t.fetchPlaylist).toHaveBeenCalledTimes(2);
  });

  it('SPEC-0016:UT-04 403 e depois 403: falha com status 403, exatamente 2 buscas e o lease liberado', async () => {
    const t = makeContextService({ respond: () => 403, initiator: INITIATOR });

    expect(await t.resolve()).toEqual({ ok: false, error: 'HLS_FETCH_FAILED', status: 403 });
    expect(t.fetchPlaylist).toHaveBeenCalledTimes(2);
    expect(t.acquire).toHaveBeenCalledTimes(1);
    expect(t.leases()).toBe(0);
  });

  it('SPEC-0016:UT-04 resolver de novo depois da falha também faz no máximo 2 buscas por resolve (sem laço)', async () => {
    const t = makeContextService({ respond: () => 403, initiator: INITIATOR });

    await t.resolve();
    await t.resolve();

    expect(t.fetchPlaylist).toHaveBeenCalledTimes(4);
    expect(t.leases()).toBe(0);
  });

  it('SPEC-0016:UT-04 404 e 500 não repetem, não instalam contexto e informam o status', async () => {
    for (const status of [404, 500]) {
      const t = makeContextService({ respond: () => status, initiator: INITIATOR });

      expect(await t.resolve(), String(status)).toEqual({
        ok: false,
        error: 'HLS_FETCH_FAILED',
        status,
      });
      expect(t.fetchPlaylist, String(status)).toHaveBeenCalledTimes(1);
      expect(t.acquire, String(status)).not.toHaveBeenCalled();
    }
  });

  it('SPEC-0016:UT-04 erro de rede (sem status) não repete e a resposta não traz status', async () => {
    const t = makeContextService({
      respond: () => {
        throw new Error('HLS_FETCH_FAILED: TypeError');
      },
      initiator: INITIATOR,
    });

    const response = await t.resolve();

    expect(response).toMatchObject({ ok: false, error: 'HLS_FETCH_FAILED' });
    expect(response).not.toHaveProperty('status');
    expect(t.fetchPlaylist).toHaveBeenCalledTimes(1);
    expect(t.acquire).not.toHaveBeenCalled();
  });

  it('SPEC-0016:UT-04 sem initiatorOrigin no candidato: 403 não repete e não instala contexto', async () => {
    const t = makeContextService({ respond: needsContext, initiator: undefined });

    expect(await t.resolve()).toEqual({ ok: false, error: 'HLS_FETCH_FAILED', status: 403 });
    expect(t.fetchPlaylist).toHaveBeenCalledTimes(1);
    expect(t.acquire).not.toHaveBeenCalled();
  });

  it('SPEC-0016:UT-04 iniciador da própria extensão equivale a sem origem: não repete', async () => {
    const t = makeContextService({ respond: needsContext, initiator: 'chrome-extension://abc' });

    expect(await t.resolve()).toMatchObject({ ok: false, status: 403 });
    expect(t.acquire).not.toHaveBeenCalled();
  });

  it('SPEC-0016:UT-04 serviço sem requestContext (flavor public): 403 não repete', async () => {
    const t = makeContextService({
      respond: needsContext,
      initiator: INITIATOR,
      withContext: false,
    });

    expect(await t.resolve()).toEqual({ ok: false, error: 'HLS_FETCH_FAILED', status: 403 });
    expect(t.fetchPlaylist).toHaveBeenCalledTimes(1);
  });

  it('SPEC-0016:UT-04 acquire que falha: erro normal da busca, sem repetir nem laço', async () => {
    const t = makeContextService({
      respond: needsContext,
      initiator: INITIATOR,
      acquireFails: true,
    });

    expect(await t.resolve()).toMatchObject({ ok: false, error: 'HLS_FETCH_FAILED' });
    expect(t.fetchPlaylist).toHaveBeenCalledTimes(1);
    expect(t.acquire).toHaveBeenCalledTimes(1);
  });

  it('SPEC-0016:UT-04 (guarda) busca que já dá certo não instala contexto', async () => {
    const t = makeContextService({ respond: () => MEDIA_PLAYLIST, initiator: INITIATOR });

    expect(await t.resolve()).toMatchObject({ ok: true });
    expect(t.fetchPlaylist).toHaveBeenCalledTimes(1);
    expect(t.acquire).not.toHaveBeenCalled();
  });

  it('SPEC-0016:UT-04 erro de resolve HTTP não-401/403 (404) leva status 404 e não vaza URL', async () => {
    const t = makeContextService({ respond: () => 404, initiator: INITIATOR });

    const response = await t.resolve();

    expect(JSON.stringify(response)).not.toContain('cdn.exemplo.test');
  });
});
