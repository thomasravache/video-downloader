/**
 * Contrato usado (SPEC-0012:UT-01) — src/core/hls-download/scheduler.ts:
 *   runSegments({ urls, concurrency, retries, backoffMs, fetch, sleep, signal, onProgress })
 *     -> Promise<Uint8Array[]> na ordem de `urls`;
 *   fetch(url, { signal }) -> Promise<Uint8Array> (rejeita em falha); sleep(ms, signal?) injetado;
 *   backoffMs(n) é chamado com n = 0, 1, 2... e o resultado é o argumento de `sleep`;
 *   falha definitiva (1 tentativa + `retries` retentativas) rejeita com SegmentFetchError (code 'FETCH_FAILED',
 *   index do segmento) e aborta o `signal` entregue aos demais fetches em andamento;
 *   `signal.abort()` rejeita com erro de nome 'AbortError' e não inicia nenhum fetch novo;
 *   onProgress({ index, bytes, segmentsDone, segmentsTotal, bytesDone }) a cada segmento concluído.
 * Nenhum relógio real: `sleep` é um dublê.
 */
import { describe, expect, it, vi } from 'vitest';
import { SegmentFetchError, runSegments } from '../../src/core/hls-download';
import type { RunSegmentsOptions } from '../../src/core/hls-download';

const bytes = (n: number): Uint8Array => new Uint8Array([n]);
const urls = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `https://cdn.test/seg${String(i)}.ts`);
const indexOf = (url: string): number => Number(/seg(\d+)/.exec(url)?.[1]);

interface Deferred {
  resolve(value: Uint8Array): void;
  reject(error: Error): void;
  signal: AbortSignal;
}

/** Inicia o agendador marcando a rejeição como tratada (o teste a verifica depois). */
function start(options: RunSegmentsOptions): Promise<Uint8Array[]> {
  const promise = runSegments(options);
  promise.catch(() => undefined);
  return promise;
}

function baseOptions(overrides: Partial<RunSegmentsOptions> = {}): RunSegmentsOptions {
  return {
    urls: urls(3),
    concurrency: 4,
    retries: 3,
    backoffMs: (n) => 250 * 2 ** n,
    fetch: (url) => Promise.resolve(bytes(indexOf(url))),
    sleep: () => Promise.resolve(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('runSegments: agendador de segmentos', () => {
  it('SPEC-0012:UT-01 devolve os bytes na ordem original mesmo quando as respostas chegam fora de ordem', async () => {
    const pending = new Map<number, Deferred>();
    const promise = start(
      baseOptions({
        urls: urls(4),
        fetch: (url, init) =>
          new Promise((resolve, reject) => {
            pending.set(indexOf(url), { resolve, reject, signal: init.signal });
          }),
      }),
    );

    for (const index of [3, 1, 0, 2]) {
      await vi.waitFor(() => {
        expect(pending.has(index)).toBe(true);
      });
      pending.get(index)?.resolve(bytes(index * 10));
    }

    expect(await promise).toEqual([bytes(0), bytes(10), bytes(20), bytes(30)]);
  });

  it('SPEC-0012:UT-01 nunca passa de 4 requisições simultâneas (concorrência 4)', async () => {
    let inFlight = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const promise = start(
      baseOptions({
        urls: urls(10),
        concurrency: 4,
        fetch: (url) =>
          new Promise((resolve) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            releases.push(() => {
              inFlight -= 1;
              resolve(bytes(indexOf(url)));
            });
          }),
      }),
    );

    await vi.waitFor(() => {
      expect(releases).toHaveLength(4);
    });
    expect(inFlight).toBe(4);
    // Libera um a um: sempre que um termina, entra o próximo, e o teto continua em 4.
    const state = { settled: false };
    void promise.then(() => {
      state.settled = true;
    });
    while (!state.settled) {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    const result = await promise;

    expect(peak).toBe(4);
    expect(result).toHaveLength(10);
  });

  it('SPEC-0012:UT-01 segmento que falha 2 vezes e depois responde: o job conclui, esperando 250 ms e 500 ms', async () => {
    const attempts = new Map<number, number>();
    const sleeps: number[] = [];

    const result = await runSegments(
      baseOptions({
        urls: urls(3),
        fetch: (url) => {
          const index = indexOf(url);
          const attempt = (attempts.get(index) ?? 0) + 1;
          attempts.set(index, attempt);
          return index === 1 && attempt <= 2
            ? Promise.reject(new Error('rede'))
            : Promise.resolve(bytes(index));
        },
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      }),
    );

    expect(result).toEqual([bytes(0), bytes(1), bytes(2)]);
    expect(attempts.get(1)).toBe(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it('SPEC-0012:UT-01 falha definitiva (4 tentativas): rejeita com SegmentFetchError FETCH_FAILED, espera 250/500/1000 ms e só tenta 4 vezes', async () => {
    const attempts = new Map<number, number>();
    const sleeps: number[] = [];

    const promise = start(
      baseOptions({
        urls: urls(1),
        fetch: (url) => {
          attempts.set(indexOf(url), (attempts.get(indexOf(url)) ?? 0) + 1);
          return Promise.reject(new Error('sempre falha'));
        },
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      }),
    );

    await expect(promise).rejects.toBeInstanceOf(SegmentFetchError);
    await expect(promise).rejects.toMatchObject({ code: 'FETCH_FAILED', index: 0 });
    expect(attempts.get(0)).toBe(4);
    expect(sleeps).toEqual([250, 500, 1000]);
  });

  it('SPEC-0012:UT-01 falha definitiva de um segmento aborta os demais em andamento e não inicia novos', async () => {
    const started: number[] = [];
    const signals = new Map<number, AbortSignal>();

    const promise = start(
      baseOptions({
        urls: urls(8),
        concurrency: 2,
        retries: 0,
        fetch: (url, init) => {
          const index = indexOf(url);
          started.push(index);
          signals.set(index, init.signal);
          return index === 0
            ? Promise.reject(new Error('quebrou'))
            : new Promise<Uint8Array>(() => undefined); // nunca responde
        },
      }),
    );

    await expect(promise).rejects.toBeInstanceOf(SegmentFetchError);
    expect(signals.get(1)?.aborted).toBe(true);
    // Só os dois primeiros chegaram a começar (0 falhou, 1 ficou pendente e foi abortado).
    expect(started.every((i) => i <= 1)).toBe(true);
    expect(started).not.toContain(2);
  });

  it('SPEC-0012:UT-01 signal.abort() rejeita com AbortError e nenhuma nova requisição começa', async () => {
    const controller = new AbortController();
    const started: number[] = [];

    const promise = start(
      baseOptions({
        urls: urls(10),
        concurrency: 2,
        signal: controller.signal,
        fetch: (url, init) => {
          started.push(indexOf(url));
          return new Promise<Uint8Array>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        },
      }),
    );
    await vi.waitFor(() => {
      expect(started).toHaveLength(2);
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toHaveLength(2);
  });

  it('SPEC-0012:UT-01 cancelar durante a espera da retentativa rejeita sem fazer nova requisição', async () => {
    const controller = new AbortController();
    let attempts = 0;

    const promise = start(
      baseOptions({
        urls: urls(1),
        signal: controller.signal,
        fetch: () => {
          attempts += 1;
          return Promise.reject(new Error('rede'));
        },
        sleep: (_ms, signal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
            controller.abort();
          }),
      }),
    );

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  it('SPEC-0012:UT-01 signal já abortado: rejeita com AbortError sem requisitar nada', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn(() => Promise.resolve(bytes(0)));

    await expect(
      runSegments(baseOptions({ signal: controller.signal, fetch })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SPEC-0012:UT-01 onProgress reporta cada segmento concluído com contagens e bytes acumulados', async () => {
    const events: { segmentsDone: number; segmentsTotal: number; bytesDone: number }[] = [];

    await runSegments(
      baseOptions({
        urls: urls(3),
        concurrency: 1,
        fetch: (url) => Promise.resolve(new Uint8Array(100 * (indexOf(url) + 1))),
        onProgress: (p) => events.push(p),
      }),
    );

    expect(events.map((e) => e.segmentsDone)).toEqual([1, 2, 3]);
    expect(events.every((e) => e.segmentsTotal === 3)).toBe(true);
    expect(events.map((e) => e.bytesDone)).toEqual([100, 300, 600]);
  });

  it('SPEC-0012:UT-01 lista vazia de URLs devolve lista vazia sem requisitar', async () => {
    const fetch = vi.fn(() => Promise.resolve(bytes(0)));

    expect(await runSegments(baseOptions({ urls: [], fetch }))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
