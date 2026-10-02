/**
 * Contrato usado (SPEC-0009:IT-01, IT-02, IT-06) com o background real (`background.main()`) e o
 * fake de `browser.*` do WXT; stubs em tests/integration/support/background.ts:
 *  - `detect` chama `scripting.executeScript({ target: { tabId, allFrames: true }, func })` UMA vez e
 *    recebe `[{ frameId, result: PageSnapshot }]`, um item por frame com acesso; itens sem
 *    `result` (frame que falhou/recarregou) são ignorados; rejeição ou nenhum frame útil =>
 *    `{ ok: false, error: 'RESTRICTED_PAGE' }`;
 *  - resposta v2: `{ ok: true, candidates: VideoCandidate[] (com frameId/frameUrl), access: { blockedOrigins } }`;
 *  - `blockedOrigins` = ⋃ `crossOriginFrames` dos frames acessíveis − origem do frame principal −
 *    origens para as quais `permissions.contains({ origins: [origem + '/*'] })` é true; ordenadas,
 *    sem repetição;
 *  - o diagnóstico (`{ type: 'diagnostics' }`) registra só ORIGENS de iframe (sem caminho/query)
 *    e todas as entradas têm `correlationId`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectResponse, FrameSnapshot } from '../../src/core/contracts';
import { injected, page, startBackground, video } from './support/background';
import type { BackgroundHarness } from './support/background';

const MAIN_URL = 'https://site.example.test/aula';
const SAME_URL = 'https://site.example.test/embed/mesma-origem';
const OTHER_URL = 'https://player.example.test/embed/1';
const A = 'https://cdn.example.test/media/a.mp4';
const B = 'https://cdn.example.test/media/b.mp4';
const C = 'https://player.example.test/media/c.mp4';

let bg: BackgroundHarness;

beforeEach(() => {
  bg = startBackground();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function frame(
  frameId: number,
  pageUrl: string,
  urls: string[],
  crossOriginFrames: string[] = [],
): FrameSnapshot {
  return {
    frameId,
    snapshot: page(
      urls.map((url) => video({ src: url, currentSrc: url })),
      { pageUrl, crossOriginFrames },
    ),
  };
}

function okResponse(response: DetectResponse) {
  if (!response.ok) {
    throw new Error(`detect falhou: ${JSON.stringify(response)}`);
  }
  return response;
}

describe('background: detect em todos os frames', () => {
  it('SPEC-0009:IT-01 detect injeta o coletor em todos os frames da aba, uma única vez', async () => {
    const { tabId } = await bg.detectFrames([frame(0, MAIN_URL, [A])]);

    expect(bg.executeScript).toHaveBeenCalledTimes(1);
    expect(bg.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId, allFrames: true } }),
    );
  });

  it('SPEC-0009:IT-01 candidatos de todos os frames chegam com frameId/frameUrl e a mesma URL em dois frames é um só', async () => {
    const { tabId, response } = await bg.detectFrames([
      frame(0, MAIN_URL, [A]),
      frame(3, SAME_URL, [A, B]),
      frame(5, OTHER_URL, [C]),
    ]);

    const { candidates } = okResponse(response);
    expect(candidates).toHaveLength(3);
    const byUrl = new Map(candidates.map((c) => [c.mediaUrl, c]));
    expect(byUrl.get(A)).toMatchObject({ frameId: 0, frameUrl: MAIN_URL, tabId });
    expect(byUrl.get(B)).toMatchObject({ frameId: 3, frameUrl: SAME_URL, tabId });
    expect(byUrl.get(C)).toMatchObject({
      frameId: 5,
      frameUrl: OTHER_URL,
      tabId,
      providerId: 'generic',
      protection: 'none',
      support: 'downloadable',
    });
    expect(new Set(candidates.map((c) => c.id)).size).toBe(3);
  });

  it('SPEC-0009:IT-01 o vídeo de um iframe é baixado pela URL original', async () => {
    bg.download.mockResolvedValue(77);
    const { response } = await bg.detectFrames([frame(0, MAIN_URL, []), frame(5, OTHER_URL, [C])]);
    const iframeCandidate = okResponse(response).candidates.find((c) => c.frameId === 5);

    const result = await bg.send({ type: 'download', candidateId: iframeCandidate?.id });

    expect(result).toEqual({ ok: true, downloadId: 77 });
    expect((bg.download.mock.calls[0]?.[0] as { url: string }).url).toBe(C);
  });

  it('SPEC-0009:IT-01 um frame que falha na injeção é ignorado e os demais continuam', async () => {
    const tabId = await bg.newTab(MAIN_URL);
    bg.executeScript.mockResolvedValue([
      { frameId: 2, error: { message: 'Frame with ID 2 was removed.' } },
      injected(frame(0, MAIN_URL, [A])),
      { frameId: 3, result: undefined },
      injected(frame(4, OTHER_URL, [C])),
    ]);

    const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;

    const { candidates } = okResponse(response);
    expect(candidates.map((c) => [c.frameId, c.mediaUrl]).sort()).toEqual([
      [0, A],
      [4, C],
    ]);
  });

  it('SPEC-0009:IT-01 executeScript rejeitando para a aba toda responde RESTRICTED_PAGE', async () => {
    const tabId = await bg.newTab(MAIN_URL);
    bg.executeScript.mockRejectedValue(new Error('Cannot access contents of the page'));

    expect(await bg.send({ type: 'detect', tabId })).toEqual({
      ok: false,
      error: 'RESTRICTED_PAGE',
    });
  });

  it('SPEC-0009:IT-01 nenhum frame acessível (resultados vazios ou sem retrato) responde RESTRICTED_PAGE', async () => {
    const tabId = await bg.newTab(MAIN_URL);

    bg.executeScript.mockResolvedValue([]);
    expect(await bg.send({ type: 'detect', tabId })).toEqual({
      ok: false,
      error: 'RESTRICTED_PAGE',
    });

    bg.executeScript.mockResolvedValue([
      { frameId: 0, error: { message: 'falhou' } },
      { frameId: 1, result: undefined },
    ]);
    expect(await bg.send({ type: 'detect', tabId })).toEqual({
      ok: false,
      error: 'RESTRICTED_PAGE',
    });
  });
});

describe('background: acesso por site (blockedOrigins)', () => {
  const BLOCKED = 'https://blocked.example.test';
  const BLOCKED_PORT = 'https://other-blocked.example.test:8443';
  const GRANTED = 'https://granted.example.test';

  function grantOnly(...granted: string[]) {
    bg.contains.mockImplementation((query: { origins: string[] }) =>
      Promise.resolve(granted.some((origin) => query.origins[0] === `${origin}/*`)),
    );
  }

  it('SPEC-0009:IT-02 detect devolve as origens de iframe sem permissão, ordenadas, sem repetição e sem a origem principal', async () => {
    grantOnly(GRANTED);
    const { response } = await bg.detectFrames([
      frame(0, MAIN_URL, [A], [BLOCKED_PORT, BLOCKED, GRANTED]),
      frame(3, `${GRANTED}/embed`, [B], ['https://site.example.test', BLOCKED, BLOCKED_PORT]),
    ]);

    expect(okResponse(response).access).toEqual({ blockedOrigins: [BLOCKED, BLOCKED_PORT] });
    expect(bg.contains).toHaveBeenCalledWith({ origins: [`${BLOCKED}/*`] });
    expect(bg.contains).toHaveBeenCalledWith({ origins: [`${GRANTED}/*`] });
  });

  it('SPEC-0009:IT-02 com todas as origens concedidas blockedOrigins é lista vazia', async () => {
    grantOnly(GRANTED, BLOCKED);
    const { response } = await bg.detectFrames([
      frame(0, MAIN_URL, [A], [GRANTED, BLOCKED]),
      frame(3, `${GRANTED}/embed`, [B]),
    ]);

    expect(okResponse(response)).toMatchObject({ access: { blockedOrigins: [] } });
    expect(okResponse(response).candidates).toHaveLength(2);
  });

  it('SPEC-0009:IT-02 iframe sem acesso não gera candidato e aparece só como origem bloqueada', async () => {
    grantOnly();
    const { response } = await bg.detectFrames([frame(0, MAIN_URL, [A], [BLOCKED])]);

    const ok = okResponse(response);
    expect(ok.candidates.map((c) => c.mediaUrl)).toEqual([A]);
    expect(ok.access).toEqual({ blockedOrigins: [BLOCKED] });
  });

  it('SPEC-0009:IT-02 página sem iframes de outra origem devolve blockedOrigins vazio', async () => {
    const { response } = await bg.detectFrames([frame(0, MAIN_URL, [A])]);

    expect(okResponse(response).access).toEqual({ blockedOrigins: [] });
  });
});

describe('diagnóstico de detect com iframes', () => {
  it('SPEC-0009:IT-06 o diagnóstico registra só origens dos iframes (sem caminho nem query) e todas as entradas têm correlationId', async () => {
    const { response } = await bg.detectFrames([
      frame(0, MAIN_URL, [A], ['https://blocked.example.test']),
      frame(4, 'https://player.example.test/embed/secret-path?sid=abc123', [C]),
    ]);
    expect(okResponse(response).access.blockedOrigins).toEqual(['https://blocked.example.test']);

    const diagnostics = (await bg.send({ type: 'diagnostics' })) as {
      ok: boolean;
      entries: Record<string, unknown>[];
    };

    expect(diagnostics.ok).toBe(true);
    const serialized = JSON.stringify(diagnostics.entries);
    expect(serialized).toContain('https://blocked.example.test');
    expect(serialized).not.toContain('secret-path');
    expect(serialized).not.toContain('sid=');
    expect(serialized).not.toContain('abc123');
    for (const entry of diagnostics.entries) {
      expect(entry['correlationId'], JSON.stringify(entry)).toEqual(expect.any(String));
      expect(entry['correlationId']).not.toBe('');
    }
  });
});
