/**
 * Contrato usado (SPEC-0024:UT-10, UT-11): entrypoints/popup/redetect.ts (o popup liga as portas ao `sendMessage`
 * e ao DOM; o controlador não toca no DOM):
 *   createRedetectController({ detect, revision, view: { render, showFailed }, busy, log }) -> { start, redetect, stop }
 *   - start(): `detect` como hoje e, com o popup aberto, `revision()` a cada REVISION_POLL_MS (1 s); revisão
 *     diferente da última vista -> `detect` de novo e `view.render(resposta, preserve)`;
 *   - lista vazia (`ok: true` sem candidatos): `detect` a cada EMPTY_RETRY_MS (3 s), por até EMPTY_RETRY_WINDOW_MS
 *     (30 s) desde a abertura;
 *   - `preserve`: ids de cartões já desenhados que continuam na nova lista (mantêm a seleção de qualidade/áudio) e
 *     ids de `busy()` (job em andamento: nunca é redesenhado);
 *   - `detect` que rejeita ou não responde em DETECT_TIMEOUT_MS (10 s) -> `view.showFailed(retry)` (mensagem
 *     `popupDetectFailed` com o botão `detect-retry`) e `log('popup.detect_failed', ...)`; `retry()` refaz o detect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectResponse, VideoCandidate } from '../../src/core/contracts';
import {
  DETECT_TIMEOUT_MS,
  EMPTY_RETRY_MS,
  EMPTY_RETRY_WINDOW_MS,
  REVISION_POLL_MS,
  createRedetectController,
} from '../../entrypoints/popup/redetect';
import type { RedetectDeps } from '../../entrypoints/popup/redetect';

function candidate(id: string): VideoCandidate {
  return {
    id,
    providerId: 'network',
    tabId: 1,
    pageUrl: 'https://site.example.test/aula',
    mediaUrl: `https://cdn.example.test/${id}.m3u8`,
    protection: 'none',
    support: 'unsupported-stream',
    frameId: 0,
    frameUrl: 'https://site.example.test/aula',
    kind: 'hls',
    source: 'network',
  };
}

const listOf = (...ids: string[]): DetectResponse => ({
  ok: true,
  candidates: ids.map(candidate),
  access: { blockedOrigins: [] },
});

function harness(initial: DetectResponse) {
  let current: Promise<DetectResponse | undefined> | (() => Promise<DetectResponse | undefined>) =
    Promise.resolve(initial);
  let revision = 0;
  let busy = new Set<string>();
  const detect = vi.fn(() => (typeof current === 'function' ? current() : current));
  const render = vi.fn<RedetectDeps['view']['render']>();
  const showFailed = vi.fn<RedetectDeps['view']['showFailed']>();
  const log = vi.fn<RedetectDeps['log']>();
  const controller = createRedetectController({
    detect,
    revision: () => Promise.resolve(revision),
    view: { render, showFailed },
    busy: () => busy,
    log,
  });
  return {
    controller,
    detect,
    render,
    showFailed,
    log,
    respond(next: DetectResponse | (() => Promise<DetectResponse | undefined>)) {
      current = typeof next === 'function' ? next : Promise.resolve(next);
    },
    setRevision(value: number) {
      revision = value;
    },
    setBusy(ids: string[]) {
      busy = new Set(ids);
    },
  };
}

const lastPreserve = (render: ReturnType<typeof harness>['render']): ReadonlySet<string> =>
  render.mock.lastCall?.[1] ?? new Set<string>();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('popup: re-detecção enquanto aberto (D4)', () => {
  it('SPEC-0024:UT-10 revisão de 0 para 1 refaz o detect uma vez e mantém o cartão que continua na lista', async () => {
    const h = harness(listOf('a', 'b'));
    await h.controller.start();
    await vi.advanceTimersByTimeAsync(3 * REVISION_POLL_MS + 100);
    expect(h.detect).toHaveBeenCalledTimes(1);
    expect(h.render).toHaveBeenCalledTimes(1);

    h.respond(listOf('a', 'c'));
    h.setRevision(1);
    await vi.advanceTimersByTimeAsync(REVISION_POLL_MS + 100);

    expect(h.detect).toHaveBeenCalledTimes(2);
    expect(h.render).toHaveBeenCalledTimes(2);
    expect(h.render.mock.lastCall?.[0]).toEqual(listOf('a', 'c'));
    const preserve = lastPreserve(h.render);
    expect(preserve.has('a')).toBe(true);
    expect(preserve.has('b')).toBe(false);
    expect(preserve.has('c')).toBe(false);

    // Revisão estável: nenhuma detecção a mais.
    await vi.advanceTimersByTimeAsync(5 * REVISION_POLL_MS);
    expect(h.detect).toHaveBeenCalledTimes(2);
    h.controller.stop();
  });

  it('SPEC-0024:UT-10 com a lista vazia refaz o detect a cada 3 s e para depois de 30 s', async () => {
    const h = harness(listOf());
    await h.controller.start();
    expect(h.detect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EMPTY_RETRY_MS + 100);
    expect(h.detect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(EMPTY_RETRY_MS);
    expect(h.detect).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(EMPTY_RETRY_WINDOW_MS + 1_000 - 2 * EMPTY_RETRY_MS - 100);
    const afterWindow = h.detect.mock.calls.length;
    expect(afterWindow).toBeGreaterThanOrEqual(10);
    expect(afterWindow).toBeLessThanOrEqual(11);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.detect).toHaveBeenCalledTimes(afterWindow);
    h.controller.stop();
  });

  it('SPEC-0024:UT-10 com um job em andamento a re-detecção não redesenha o cartão do job', async () => {
    const h = harness(listOf('a', 'job'));
    await h.controller.start();
    h.setBusy(['job']);

    h.respond(listOf('job', 'c'));
    h.setRevision(1);
    await vi.advanceTimersByTimeAsync(REVISION_POLL_MS + 100);

    expect(h.detect).toHaveBeenCalledTimes(2);
    expect(lastPreserve(h.render).has('job')).toBe(true);

    // Mesmo se a nova lista não trouxer o cartão do job, ele não é redesenhado.
    h.respond(listOf('c'));
    h.setRevision(2);
    await vi.advanceTimersByTimeAsync(REVISION_POLL_MS + 100);

    expect(h.detect).toHaveBeenCalledTimes(3);
    expect(lastPreserve(h.render).has('job')).toBe(true);
    h.controller.stop();
  });

  it('SPEC-0024:UT-10 redetect() ("Procurar de novo") refaz o detect na hora', async () => {
    const h = harness(listOf('a'));
    await h.controller.start();

    await h.controller.redetect();

    expect(h.detect).toHaveBeenCalledTimes(2);
    expect(h.render).toHaveBeenCalledTimes(2);
    h.controller.stop();
  });
});

describe('popup: pedidos durante uma detecção e página restrita (D4, revisão G4)', () => {
  const RESTRICTED: DetectResponse = { ok: false, error: 'RESTRICTED_PAGE' };

  it('SPEC-0024:UT-10 redetect() pedido com um detect em andamento roda exatamente mais um detect depois dele (vários pedidos viram um)', async () => {
    const h = harness(listOf('a'));
    let finishFirst: (value: DetectResponse) => void = () => undefined;
    h.respond(
      () =>
        new Promise<DetectResponse | undefined>((resolve) => {
          finishFirst = resolve;
        }),
    );
    void h.controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.detect).toHaveBeenCalledTimes(1);

    h.respond(listOf('a', 'b'));
    void h.controller.redetect();
    void h.controller.redetect();
    void h.controller.redetect();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.detect).toHaveBeenCalledTimes(1);

    finishFirst(listOf('a'));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.detect).toHaveBeenCalledTimes(2);
    expect(h.render.mock.lastCall?.[0]).toEqual(listOf('a', 'b'));
    await vi.advanceTimersByTimeAsync(5 * REVISION_POLL_MS);
    expect(h.detect).toHaveBeenCalledTimes(2);
    h.controller.stop();
  });

  it('SPEC-0024:UT-10 RESTRICTED_PAGE na abertura é refeito a cada 3 s e para quando a lista aparece', async () => {
    const h = harness(RESTRICTED);
    await h.controller.start();
    expect(h.detect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EMPTY_RETRY_MS + 100);
    expect(h.detect).toHaveBeenCalledTimes(2);

    h.respond(listOf('a'));
    await vi.advanceTimersByTimeAsync(EMPTY_RETRY_MS);
    expect(h.detect).toHaveBeenCalledTimes(3);
    expect(h.render.mock.lastCall?.[0]).toEqual(listOf('a'));

    await vi.advanceTimersByTimeAsync(4 * EMPTY_RETRY_MS);
    expect(h.detect).toHaveBeenCalledTimes(3);
    h.controller.stop();
  });

  it('SPEC-0024:UT-10 RESTRICTED_PAGE que persiste é refeito por até 30 s e depois para', async () => {
    const h = harness(RESTRICTED);
    await h.controller.start();

    await vi.advanceTimersByTimeAsync(EMPTY_RETRY_WINDOW_MS + 1_000);
    const afterWindow = h.detect.mock.calls.length;
    expect(afterWindow).toBeGreaterThanOrEqual(10);
    expect(afterWindow).toBeLessThanOrEqual(11);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.detect).toHaveBeenCalledTimes(afterWindow);
    h.controller.stop();
  });
});

describe('popup: detect que falha (D2)', () => {
  it('SPEC-0024:UT-11 detect que rejeita mostra o erro com "Tentar de novo", registra popup.detect_failed e o clique refaz o detect', async () => {
    const h = harness(listOf('a'));
    h.respond(() => Promise.reject(new Error('Could not establish connection')));

    await h.controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.showFailed).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls.map(([event]) => event)).toContain('popup.detect_failed');
    const retry = h.showFailed.mock.lastCall?.[0];
    expect(retry).toEqual(expect.any(Function));

    h.respond(listOf('a'));
    retry?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.detect).toHaveBeenCalledTimes(2);
    expect(h.render.mock.lastCall?.[0]).toEqual(listOf('a'));
    h.controller.stop();
  });

  it('SPEC-0024:UT-11 detect que não responde em 10 s mostra o erro com "Tentar de novo" e registra popup.detect_failed', async () => {
    const h = harness(listOf('a'));
    h.respond(() => new Promise<DetectResponse | undefined>(() => undefined));

    void h.controller.start();
    await vi.advanceTimersByTimeAsync(DETECT_TIMEOUT_MS - 500);
    expect(h.showFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.showFailed).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls.map(([event]) => event)).toContain('popup.detect_failed');
    h.controller.stop();
  });
});
