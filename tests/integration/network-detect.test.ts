/**
 * Contrato usado (SPEC-0010:IT-01, IT-02, IT-03, IT-05), background real + fakeBrowser:
 *  - entrypoints/background registra, ao rodar `main()`:
 *      webRequest.onResponseStarted.addListener(cb, { urls: ['http://*\/*', 'https://*\/*'] }, ['responseHeaders'])
 *      webRequest.onBeforeRequest.addListener(cb, { urls: [...], types: ['main_frame'] })
 *      tabs.onRemoved (já existente) também descarta a lista de rede da aba;
 *    SPEC-0024 (D7): a lista da aba é apagada no `onResponseStarted` de `main_frame` que troca o documento,
 *    não mais no `onBeforeRequest` (que continua registrado só para o indicador da toolbar, SPEC-0022);
 *    o harness (tests/integration/support/background.ts) captura esses listeners e os chama.
 *  - cada resposta aceita por `classifyNetworkResponse` (src/core/network.ts) é gravada em
 *    storage.session na chave 'vd:net:<tabId>' (NetworkStore sobre a SessionStoragePort);
 *    tamanho = Content-Length, ou o total de `Content-Range: bytes a-b/total` em respostas 206;
 *  - `detect` devolve mergeCandidates(DOM de todos os frames, NetworkStore.forTab(tabId)):
 *      MP4 de rede -> kind 'file', source 'network', support 'downloadable';
 *      HLS/DASH   -> kind 'hls'|'dash', source 'network', support 'unsupported-stream';
 *      candidatos do DOM -> source 'dom';
 *  - `download` de um candidato de rede 'file' chama downloads.download com a URL original;
 *  - o diagnóstico (mensagem 'diagnostics') nunca contém query strings (ADR-0009).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import background from '../../entrypoints/background';
import { injected, page, startBackground, video } from './support/background';
import type { BackgroundHarness } from './support/background';
import type { DetectResponse, VideoCandidate } from '../../src/core/contracts';

const PAGE = 'https://site.example.test/aula';
const MP4 = 'https://cdn.example.test/media/aula.mp4';
const HLS = 'https://cdn.example.test/hls/master.m3u8';
const IMG = 'https://cdn.example.test/img/capa.png';
const MP4_HEADERS = { 'Content-Type': 'video/mp4', 'Content-Length': '5000000' };
const HLS_HEADERS = { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': '700' };

let bg: BackgroundHarness;

beforeEach(() => {
  bg = startBackground();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `detect` numa aba cuja página não tem `<video>` no DOM (só a rede conta). */
async function detectTab(tabId: number): Promise<VideoCandidate[]> {
  bg.executeScript.mockResolvedValue([injected({ frameId: 0, snapshot: page([]) })]);
  const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;
  if (!response.ok) {
    throw new Error(`detect falhou: ${JSON.stringify(response)}`);
  }
  return response.candidates;
}

const trigger = (event: unknown, ...args: unknown[]) =>
  (event as { trigger(...a: unknown[]): Promise<unknown> }).trigger(...args);

describe('detecção por rede: webRequest -> detect/download', () => {
  it('SPEC-0010:IT-01 o background registra os listeners de webRequest (só leitura) com filtro http(s) e main_frame', () => {
    const { responseStarted, beforeRequest } = bg.network;

    expect(responseStarted.registrations).toHaveLength(1);
    expect(responseStarted.registrations[0]?.filter?.urls).toEqual(['http://*/*', 'https://*/*']);
    expect(responseStarted.registrations[0]?.extraInfoSpec).toEqual(['responseHeaders']);
    expect(beforeRequest.registrations).toHaveLength(1);
    expect(beforeRequest.registrations[0]?.filter?.types).toEqual(['main_frame']);
    expect(beforeRequest.registrations[0]?.extraInfoSpec ?? []).not.toContain('blocking');
  });

  it('SPEC-0010:IT-01 respostas de MP4, HLS e imagem resultam em detect listando só MP4 e HLS (HLS unsupported-stream)', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });
    await bg.network.respond({ url: HLS, tabId, headers: HLS_HEADERS });
    await bg.network.respond({ url: IMG, tabId, headers: { 'Content-Type': 'image/png' } });

    const candidates = await detectTab(tabId);

    expect(candidates.map((c) => c.mediaUrl).sort()).toEqual([HLS, MP4].sort());
    const byUrl = new Map(candidates.map((c) => [c.mediaUrl, c]));
    expect(byUrl.get(MP4)).toMatchObject({
      kind: 'file',
      source: 'network',
      support: 'downloadable',
      protection: 'none',
      tabId,
      sizeBytes: 5_000_000,
    });
    expect(byUrl.get(HLS)).toMatchObject({
      kind: 'hls',
      source: 'network',
      support: 'unsupported-stream',
    });
  });

  it('SPEC-0010:IT-01 download do MP4 de rede chama downloads.download com a URL; o HLS responde UNSUPPORTED', async () => {
    bg.download.mockResolvedValue(31);
    const tabId = await bg.newTab(PAGE);
    const mp4WithQuery = `${MP4}?sig=abc`;
    await bg.network.respond({ url: mp4WithQuery, tabId, headers: MP4_HEADERS });
    await bg.network.respond({ url: HLS, tabId, headers: HLS_HEADERS });
    const candidates = await detectTab(tabId);
    const mp4 = candidates.find((c) => c.kind === 'file');
    const hls = candidates.find((c) => c.kind === 'hls');

    const ok = await bg.send({ type: 'download', candidateId: mp4?.id });
    const unsupported = await bg.send({ type: 'download', candidateId: hls?.id });

    expect(ok).toEqual({ ok: true, downloadId: 31 });
    expect(bg.download).toHaveBeenCalledTimes(1);
    expect((bg.download.mock.calls[0]?.[0] as { url: string }).url).toBe(mp4WithQuery);
    // SPEC-0012: HLS ainda não resolvido (sem `hls`) continua sem download; o motivo pode ser
    // UNSUPPORTED (support) ou HLS_NOT_RESOLVED (desconhecido nunca é tratado como limpo).
    expect(unsupported).toMatchObject({ ok: false });
    expect(['UNSUPPORTED', 'HLS_NOT_RESOLVED']).toContain((unsupported as { error: string }).error);
  });

  it('SPEC-0010:IT-01 resposta 206 usa o total do Content-Range como tamanho', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({
      url: MP4,
      tabId,
      statusCode: 206,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '100',
        'content-range': 'bytes 0-99/5000000',
      },
    });

    const candidates = await detectTab(tabId);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.sizeBytes).toBe(5_000_000);
  });

  it('SPEC-0010:IT-01 (guarda: passa antes da mudança) respostas ignoradas: POST, 404, aba -1, segmento .ts e MP4 minúsculo não entram na lista', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, method: 'POST', headers: MP4_HEADERS });
    await bg.network.respond({ url: `${MP4}?b`, tabId, statusCode: 404, headers: MP4_HEADERS });
    await bg.network.respond({ url: `${MP4}?c`, tabId: -1, headers: MP4_HEADERS });
    await bg.network.respond({
      url: 'https://cdn.example.test/seg/1.ts',
      tabId,
      headers: { 'Content-Type': 'video/mp2t', 'Content-Length': '900000' },
    });
    await bg.network.respond({
      url: `${MP4}?d`,
      tabId,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': '2048' },
    });

    expect(await detectTab(tabId)).toEqual([]);
  });

  it('SPEC-0010:IT-01 (guarda: passa antes da mudança) o mesmo vídeo no DOM e na rede aparece uma vez, como source dom (kind file)', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });
    bg.executeScript.mockResolvedValue([
      injected({ frameId: 0, snapshot: page([video({ src: MP4, currentSrc: MP4 })]) }),
    ]);

    const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;

    expect(response.ok).toBe(true);
    const candidates = response.ok ? response.candidates : [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ mediaUrl: MP4, source: 'dom', kind: 'file' });
  });

  it('SPEC-0010:IT-02 recriar o background (suspensão do service worker) mantém a lista de rede da aba', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });
    await bg.network.respond({ url: HLS, tabId, headers: HLS_HEADERS });
    // O estado está em storage.session (chave do contrato), não em memória do service worker.
    const stored = await fakeBrowser.storage.session.get(`vd:net:${String(tabId)}`);
    expect(JSON.stringify(stored)).toContain(MP4);

    bg.restart();

    expect(bg.network.responseStarted.registrations).toHaveLength(1);
    const candidates = await detectTab(tabId);
    expect(candidates.map((c) => c.mediaUrl).sort()).toEqual([HLS, MP4].sort());
  });

  it('SPEC-0010:IT-02 depois da suspensão um novo detect lista o item de rede e o download dele funciona', async () => {
    bg.download.mockResolvedValue(5);
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });

    bg.restart();
    const after = (await detectTab(tabId))[0];
    const found = await bg.send({ type: 'download', candidateId: after?.id });

    expect(found).toEqual({ ok: true, downloadId: 5 });
    expect((bg.download.mock.calls[0]?.[0] as { url: string }).url).toBe(MP4);
  });

  it('SPEC-0010:IT-03 a resposta de main_frame que troca o documento limpa a lista só da aba que navegou (regra D7 da SPEC-0024)', async () => {
    const tabA = await bg.newTab(PAGE);
    const tabB = await bg.newTab('https://other.example.test/');
    await bg.network.respond({ url: MP4, tabId: tabA, headers: MP4_HEADERS });
    await bg.network.respond({ url: `${MP4}?b`, tabId: tabB, headers: MP4_HEADERS });
    expect(await detectTab(tabA)).toHaveLength(1);

    await bg.network.navigate(tabA, 'https://site.example.test/outra');
    await bg.network.mainFrameResponse(tabA, 'https://site.example.test/outra');

    expect(await detectTab(tabA)).toEqual([]);
    expect((await detectTab(tabB)).map((c) => c.mediaUrl)).toEqual([`${MP4}?b`]);
    expect(await fakeBrowser.storage.session.get(`vd:net:${String(tabA)}`)).toEqual({});
  });

  it('SPEC-0010:IT-03 tabs.onRemoved descarta a lista de rede da aba', async () => {
    const tabA = await bg.newTab(PAGE);
    const tabB = await bg.newTab('https://other.example.test/');
    await bg.network.respond({ url: MP4, tabId: tabA, headers: MP4_HEADERS });
    await bg.network.respond({ url: `${MP4}?b`, tabId: tabB, headers: MP4_HEADERS });

    await trigger(fakeBrowser.tabs.onRemoved, tabA, { windowId: 0, isWindowClosing: false });

    expect(await fakeBrowser.storage.session.get(`vd:net:${String(tabA)}`)).toEqual({});
    expect(await detectTab(tabA)).toEqual([]);
    expect(await detectTab(tabB)).toHaveLength(1);
  });

  it('SPEC-0010:IT-05 depois de eventos de rede com ?token=... o diagnóstico não contém token= e toda entrada tem correlationId', async () => {
    const tabId = await bg.newTab(`${PAGE}?token=pagina`);
    await bg.network.respond({ url: `${MP4}?token=abc123`, tabId, headers: MP4_HEADERS });
    await bg.network.respond({ url: `${HLS}?token=xyz789&x=1`, tabId, headers: HLS_HEADERS });
    await bg.network.respond({
      url: `${IMG}?token=img`,
      tabId,
      headers: { 'Content-Type': 'image/png' },
    });
    const candidates = await detectTab(tabId);
    const mp4 = candidates.find((c) => c.kind === 'file');
    await bg.send({ type: 'download', candidateId: mp4?.id });
    await bg.network.navigate(tabId, 'https://site.example.test/x?token=nav');

    const diagnostics = (await bg.send({ type: 'diagnostics' })) as {
      ok: boolean;
      entries: Record<string, unknown>[];
    };

    expect(candidates).toHaveLength(2);
    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.entries.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(diagnostics.entries);
    expect(serialized).not.toContain('token=');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('xyz789');
    for (const entry of diagnostics.entries) {
      expect(entry['correlationId'], JSON.stringify(entry)).toEqual(expect.any(String));
      expect(entry['correlationId']).not.toBe('');
    }
  });
});

type DiagnosticsResponse = { ok: boolean; entries: Record<string, unknown>[] };

/** Recria o background com um `browser.webRequest` arbitrário (o harness já rodou `main()` uma vez). */
function remountWithWebRequest(webRequest: unknown): void {
  fakeBrowser.runtime.onMessage.removeAllListeners();
  fakeBrowser.tabs.onRemoved.removeAllListeners();
  Object.defineProperty(fakeBrowser, 'webRequest', { configurable: true, value: webRequest });
  background.main();
}

describe('detecção por rede: webRequest indisponível e navegação sem aba (Emenda 2)', () => {
  it('SPEC-0010:IT-06 sem browser.webRequest o main() não lança, o DOM continua detectando e o diagnóstico registra network.unavailable/no_api', async () => {
    expect(() => {
      remountWithWebRequest(undefined);
    }).not.toThrow();

    const { candidates } = await bg.detect(
      page([video({ src: 'https://cdn.example.test/dom.mp4' })]),
    );
    const diagnostics = (await bg.send({ type: 'diagnostics' })) as DiagnosticsResponse;

    expect(candidates.some((c) => c.source === 'dom')).toBe(true);
    const entry = diagnostics.entries.find((e) => e['event'] === 'network.unavailable');
    expect(entry, JSON.stringify(diagnostics.entries)).toBeDefined();
    expect(entry).toMatchObject({ reason: 'no_api' });
    expect(entry?.['correlationId']).toEqual(expect.any(String));
  });

  it('SPEC-0010:IT-06 com addListener lançando TypeError o main() não lança, os demais registros acontecem e o diagnóstico traz só o nome do erro', async () => {
    const beforeRequestAdd = vi.fn();
    const responseAdd = vi.fn(() => {
      throw new TypeError('falha em https://cdn.example.test/x.mp4?token=segredo');
    });
    expect(() => {
      remountWithWebRequest({
        onResponseStarted: { addListener: responseAdd },
        onBeforeRequest: { addListener: beforeRequestAdd },
      });
    }).not.toThrow();

    const { candidates } = await bg.detect(
      page([video({ src: 'https://cdn.example.test/dom.mp4' })]),
    );
    const diagnostics = (await bg.send({ type: 'diagnostics' })) as DiagnosticsResponse;

    expect(responseAdd).toHaveBeenCalledTimes(1);
    expect(beforeRequestAdd).toHaveBeenCalledTimes(1);
    expect(fakeBrowser.tabs.onRemoved.hasListeners()).toBe(true);
    expect(candidates.some((c) => c.source === 'dom')).toBe(true);
    const entry = diagnostics.entries.find((e) => e['event'] === 'network.unavailable');
    expect(entry, JSON.stringify(diagnostics.entries)).toBeDefined();
    expect(entry).toMatchObject({ reason: 'TypeError' });
    const serialized = JSON.stringify(diagnostics.entries);
    expect(serialized).not.toContain('token=');
    expect(serialized).not.toContain('segredo');
    expect(serialized).not.toContain('x.mp4');
  });

  it('SPEC-0010:IT-06 main_frame com tabId -1 é ignorado: a lista da aba real fica intacta e nenhuma chave vd:net:-1 é criada', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });

    const remove = vi.spyOn(fakeBrowser.storage.session, 'remove');
    const set = vi.spyOn(fakeBrowser.storage.session, 'set');
    await bg.network.navigate(-1, 'https://site.example.test/outra');
    await bg.network.mainFrameResponse(-1, 'https://site.example.test/outra');

    expect(JSON.stringify([...remove.mock.calls, ...set.mock.calls])).not.toContain('vd:net:-1');
    const all = await fakeBrowser.storage.session.get(null);
    expect(Object.keys(all)).not.toContain('vd:net:-1');
    expect((await detectTab(tabId)).map((c) => c.mediaUrl)).toEqual([MP4]);
  });

  it('SPEC-0010:IT-06 (guarda) main_frame com tabId >= 0 continua limpando a lista daquela aba (na resposta que troca o documento, D7 da SPEC-0024)', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });

    await bg.network.navigate(tabId, 'https://site.example.test/outra');
    await bg.network.mainFrameResponse(tabId, 'https://site.example.test/outra');

    expect(await fakeBrowser.storage.session.get(`vd:net:${String(tabId)}`)).toEqual({});
    expect(await detectTab(tabId)).toEqual([]);
  });

  it('SPEC-0018:IT-03 captura de rede com master e playlist de legendas: apenas master gera candidato, legendas sao filtradas', async () => {
    const tabId = await bg.newTab(PAGE);
    const SUBS = 'https://cdn.example.test/hls/subtitles.m3u8';
    await bg.network.respond({ url: HLS, tabId, headers: HLS_HEADERS });
    await bg.network.respond({
      url: SUBS,
      tabId,
      headers: { 'Content-Type': 'text/vtt' },
    });

    const candidates = await detectTab(tabId);
    expect(candidates.map((c) => c.mediaUrl)).toEqual([HLS]);
    expect(candidates.some((c) => c.mediaUrl === SUBS)).toBe(false);
  });
});

/**
 * Contrato usado (SPEC-0024:IT-01..IT-06), background real + fakeBrowser:
 *  - D1: `scripting.executeScript` rejeitando não esconde a lista de rede da aba no `detect`;
 *  - D5: com um master na aba, `.mp4` da mesma pasta (ou subpasta) é segmento e não entra na lista;
 *  - D7: a lista é apagada no `onResponseStarted` de `main_frame` que troca o documento (2xx exceto 204/205, sem
 *    `Content-Disposition: attachment`), e não mais no `onBeforeRequest`; a mensagem
 *    `{ type: 'network-revision', tabId }` devolve `{ ok: true, revision }`, que cresce a cada add/clear;
 *  - D8: resposta com `tabId = -1` e `initiator` igual à origem de uma aba aberta (`tabs.query`) entra na lista dela;
 *  - D10: resposta descartada não chama `tabs.get`, `storage.session.get` nem `action.setBadgeText`;
 *  - D9: dois masters no mesmo caminho com `id` diferente não são agrupados (`groupCandidates`) como redundantes.
 */
describe('detecção estável entre contas e páginas (SPEC-0024)', () => {
  const MP4_SEGMENT_HEADERS = { 'Content-Type': 'video/mp4', 'Content-Length': String(200 * 1024) };

  async function revisionOf(tabId: number): Promise<number> {
    const response = (await bg.send({ type: 'network-revision', tabId })) as {
      ok: boolean;
      revision?: unknown;
    };
    expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
    expect(response.revision).toEqual(expect.any(Number));
    return response.revision as number;
  }

  it('SPEC-0024:IT-01 executeScript rejeita e a NetworkStore real tem um .m3u8 da aba: o detect pela mensagem devolve o HLS', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: HLS, tabId, headers: HLS_HEADERS });
    expect(JSON.stringify(await fakeBrowser.storage.session.get(null))).toContain(HLS);
    bg.executeScript.mockRejectedValue(new Error('Frame with ID 0 was removed.'));

    const response = (await bg.send({ type: 'detect', tabId })) as DetectResponse;

    expect(response).toMatchObject({ ok: true });
    const candidates = response.ok ? response.candidates : [];
    expect(candidates.map((c) => [c.kind, c.mediaUrl])).toEqual([['hls', HLS]]);
  });

  it('SPEC-0024:IT-02 um master e 70 segmentos .mp4 da mesma pasta: a lista da aba tem só o master', async () => {
    const tabId = await bg.newTab(PAGE);
    const master = 'https://cdn.example.test/v/abc/master.m3u8';
    await bg.network.respond({ url: master, tabId, headers: HLS_HEADERS });
    for (let n = 0; n < 70; n++) {
      await bg.network.respond({
        url: `https://cdn.example.test/v/abc/720/seg-${String(n)}.mp4`,
        tabId,
        headers: MP4_SEGMENT_HEADERS,
      });
    }

    expect((await detectTab(tabId)).map((c) => c.mediaUrl)).toEqual([master]);
  });

  it('SPEC-0024:IT-03 main_frame 204 e onBeforeRequest sem resposta mantêm a lista', async () => {
    const tabId = await bg.newTab(PAGE);
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });

    await bg.network.mainFrameResponse(tabId, 'https://site.example.test/baixar', {
      statusCode: 204,
      headers: {},
    });
    await bg.network.navigate(tabId, 'https://site.example.test/link-cancelado');
    await bg.network.mainFrameResponse(tabId, 'https://site.example.test/material.zip', {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename=material.zip',
      },
    });

    expect((await detectTab(tabId)).map((c) => c.mediaUrl)).toEqual([MP4]);
  });

  it('SPEC-0024:IT-03 main_frame 200 text/html apaga a lista da aba e incrementa a revisão', async () => {
    const tabId = await bg.newTab(PAGE);
    const other = await bg.newTab('https://other.example.test/');
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });
    await bg.network.respond({ url: `${MP4}?b`, tabId: other, headers: MP4_HEADERS });
    const before = await revisionOf(tabId);

    await bg.network.mainFrameResponse(tabId, 'https://site.example.test/outra-aula');

    expect(await detectTab(tabId)).toEqual([]);
    expect(await revisionOf(tabId)).toBeGreaterThan(before);
    expect((await detectTab(other)).map((c) => c.mediaUrl)).toEqual([`${MP4}?b`]);
  });

  it('SPEC-0024:IT-04 tabId -1 com initiator igual à origem de uma aba aberta põe o candidato na lista dessa aba', async () => {
    const tabId = await bg.newTab(PAGE);
    const other = await bg.newTab('https://other.example.test/');
    vi.spyOn(
      fakeBrowser.tabs as unknown as Record<string, (...args: unknown[]) => unknown>,
      'query',
    ).mockResolvedValue([
      { id: tabId, url: PAGE, index: 0, windowId: 1, active: true },
      { id: other, url: 'https://other.example.test/', index: 1, windowId: 1, active: false },
    ]);

    await bg.network.respond({
      url: HLS,
      tabId: -1,
      frameId: -1,
      initiator: 'https://site.example.test',
      headers: HLS_HEADERS,
    });

    expect((await detectTab(tabId)).map((c) => [c.kind, c.mediaUrl])).toEqual([['hls', HLS]]);
    expect(await detectTab(other)).toEqual([]);
    const all = await fakeBrowser.storage.session.get(null);
    expect(Object.keys(all)).not.toContain('vd:net:-1');
  });

  it('SPEC-0024:IT-05 200 respostas descartadas (imagem/JS) não chamam tabs.get, storage.session.get nem action.setBadgeText', async () => {
    const tabId = await bg.newTab(PAGE);
    const tabsGet = vi.mocked(fakeBrowser.tabs.get);
    const sessionGet = vi.spyOn(fakeBrowser.storage.session, 'get');
    const setBadgeText = vi
      .spyOn(fakeBrowser.action as unknown as Record<string, () => unknown>, 'setBadgeText')
      .mockResolvedValue(undefined);
    tabsGet.mockClear();

    await Promise.all(
      Array.from({ length: 200 }, (_, n) => {
        const isImage = n % 2 === 0;
        return bg.network.respond({
          url: `https://cdn.example.test/assets/${String(n)}.${isImage ? 'png' : 'js'}`,
          tabId,
          type: isImage ? 'image' : 'script',
          headers: { 'Content-Type': isImage ? 'image/png' : 'text/javascript' },
        });
      }),
    );

    expect(tabsGet).not.toHaveBeenCalled();
    expect(sessionGet).not.toHaveBeenCalled();
    expect(setBadgeText).not.toHaveBeenCalled();

    // O listener estava ativo: uma resposta de vídeo depois disso entra na lista.
    await bg.network.respond({ url: MP4, tabId, headers: MP4_HEADERS });
    expect((await detectTab(tabId)).map((c) => c.mediaUrl)).toEqual([MP4]);
  });
});
