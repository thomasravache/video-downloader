/** Agendador de segmentos (SPEC-0012:UT-01). Assinatura apenas. */

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

/**
 * Baixa `urls` em paralelo (`concurrency`), com `retries` retentativas por segmento, e devolve os
 * bytes na ordem original. Falha definitiva: rejeita com `SegmentFetchError` e aborta os demais.
 * `signal.abort()`: rejeita com um erro de nome `AbortError` e não inicia novas requisições.
 */
export function runSegments(_options: RunSegmentsOptions): Promise<Uint8Array[]> {
  return Promise.reject(new Error('NotImplemented'));
}
