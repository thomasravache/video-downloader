/** Agendador de segmentos (SPEC-0012:UT-01): concorrência limitada, retentativas, ordem e abort. */
import { SegmentFetchError } from './errors';

export type SegmentFetch = (url: string, init: { signal: AbortSignal }) => Promise<Uint8Array>;

export interface SegmentProgress {
  /** Índice do segmento concluído (ordem original). */
  index: number;
  bytes: number;
  segmentsDone: number;
  segmentsTotal: number;
  bytesDone: number;
}

export interface RunSegmentsOptions {
  urls: readonly string[];
  concurrency: number;
  retries: number;
  /** Espera antes da retentativa `n` (0, 1, 2...); padrão do produto: `250 * 2 ** n`. */
  backoffMs: (n: number) => number;
  fetch: SegmentFetch;
  /** Rejeita cedo quando `signal` aborta. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  onProgress?: (progress: SegmentProgress) => void;
}

function abortError(): Error {
  return new DOMException('aborted', 'AbortError');
}

/**
 * Baixa `urls` em paralelo (`concurrency`), com `retries` retentativas por segmento, e devolve os
 * bytes na ordem original. Falha definitiva: rejeita com `SegmentFetchError` e aborta os demais.
 * `signal.abort()`: rejeita com um erro de nome `AbortError` e não inicia novas requisições.
 */
export function runSegments(options: RunSegmentsOptions): Promise<Uint8Array[]> {
  const { urls, concurrency, retries, backoffMs, sleep, signal: external } = options;
  if (external.aborted) {
    return Promise.reject(abortError());
  }
  const total = urls.length;
  if (total === 0) {
    return Promise.resolve([]);
  }

  return new Promise<Uint8Array[]>((resolve, reject) => {
    const internal = new AbortController();
    const results = new Array<Uint8Array>(total);
    let next = 0;
    let done = 0;
    let bytesDone = 0;
    const flags = { settled: false };
    const isSettled = (): boolean => flags.settled;

    const finish = (error?: Error): void => {
      if (isSettled()) {
        return;
      }
      flags.settled = true;
      external.removeEventListener('abort', onExternalAbort);
      if (error) {
        internal.abort();
        reject(error);
      } else {
        resolve(results);
      }
    };
    function onExternalAbort(): void {
      finish(abortError());
    }
    external.addEventListener('abort', onExternalAbort);

    async function fetchWithRetry(index: number): Promise<Uint8Array | undefined> {
      const url = urls[index] as string;
      for (let attempt = 0; ; attempt++) {
        if (isSettled()) {
          return undefined;
        }
        try {
          return await options.fetch(url, { signal: internal.signal });
        } catch {
          if (flags.settled) {
            return undefined;
          }
          if (attempt >= retries) {
            throw new SegmentFetchError(index);
          }
          try {
            await sleep(backoffMs(attempt), internal.signal);
          } catch {
            if (isSettled()) {
              return undefined;
            }
          }
        }
      }
    }

    async function worker(): Promise<void> {
      while (!isSettled() && next < total) {
        const index = next++;
        const bytes = await fetchWithRetry(index);
        if (bytes === undefined || isSettled()) {
          return;
        }
        results[index] = bytes;
        done += 1;
        bytesDone += bytes.byteLength;
        options.onProgress?.({
          index,
          bytes: bytes.byteLength,
          segmentsDone: done,
          segmentsTotal: total,
          bytesDone,
        });
        if (done === total) {
          finish();
        }
      }
    }

    const workers = Math.max(1, Math.min(concurrency, total));
    for (let i = 0; i < workers; i++) {
      worker().catch((error: unknown) => {
        finish(error instanceof Error ? error : new SegmentFetchError(-1));
      });
    }
  });
}
