/** Execução de um job no offscreen (SPEC-0012); sem `chrome.*`: tudo entra por `deps`. */
import {
  AssemblyError,
  MAX_BUFFERED_BYTES,
  SegmentFetchError,
  runSegments,
} from '../../src/core/hls-download';
import type { JobError, OffscreenEvent, OffscreenStart } from '../../src/core/hls-download';
import { assembleFmp4, assembleTs } from './assemble';

export interface OffscreenJobDeps {
  fetch: typeof fetch;
  /** Entrega progresso/resultado ao background. */
  emit: (event: OffscreenEvent) => void;
  signal: AbortSignal;
  /** Padrão: espera real; os testes injetam uma espera imediata. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const CONCURRENCY = 4;
const RETRIES = 3;

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const isAborted = (signal: AbortSignal): boolean => signal.aborted;

function errorCode(error: unknown): JobError {
  if (error instanceof AssemblyError) {
    return error.code;
  }
  if (error instanceof SegmentFetchError) {
    return 'FETCH_FAILED';
  }
  return 'ASSEMBLY_FAILED';
}

/**
 * Baixa os segmentos (`runSegments`: concorrência 4, 3 retentativas), monta (`assembleTs`/`assembleFmp4`),
 * cria a blob URL (`URL.createObjectURL`) e emite `ready`; em falha emite `failed` com o `JobError`.
 * Cancelamento (`signal`): resolve sem emitir `ready`/`failed`, sem novas requisições.
 */
export async function runOffscreenJob(
  request: OffscreenStart,
  deps: OffscreenJobDeps,
): Promise<void> {
  const job = new AbortController();
  const relay = (): void => {
    job.abort();
  };
  if (deps.signal.aborted) {
    return;
  }
  deps.signal.addEventListener('abort', relay, { once: true });

  // Memória: bytes já recebidos + o que as respostas em andamento declaram (Content-Length).
  let completedBytes = 0;
  const inFlight = new Map<number, number>();
  let requestId = 0;
  const flags = { tooLarge: false };
  const isTooLarge = (): boolean => flags.tooLarge;
  const buffered = (): number => completedBytes + [...inFlight.values()].reduce((a, b) => a + b, 0);
  const checkLimit = (): void => {
    if (!flags.tooLarge && buffered() > MAX_BUFFERED_BYTES) {
      flags.tooLarge = true;
      job.abort();
    }
  };

  async function fetchBytes(url: string, init: { signal: AbortSignal }): Promise<Uint8Array> {
    const id = requestId++;
    inFlight.set(id, 0);
    try {
      const response = await deps.fetch(url, { signal: init.signal, credentials: 'include' });
      if (!response.ok) {
        throw new Error('status');
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > 0) {
        inFlight.set(id, declared);
        checkLimit();
      }
      if (isTooLarge()) {
        throw new DOMException('aborted', 'AbortError');
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
          received += value.byteLength;
          inFlight.set(id, Math.max(inFlight.get(id) ?? 0, received));
          checkLimit();
          if (isTooLarge()) {
            await reader.cancel().catch(() => undefined);
            throw new DOMException('aborted', 'AbortError');
          }
        }
      }
      const out = new Uint8Array(received);
      let at = 0;
      for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.byteLength;
      }
      completedBytes += received;
      return out;
    } finally {
      inFlight.delete(id);
    }
  }

  const common = {
    concurrency: CONCURRENCY,
    retries: RETRIES,
    backoffMs: (n: number) => 250 * 2 ** n,
    fetch: fetchBytes,
    sleep: deps.sleep ?? realSleep,
    signal: job.signal,
  };

  try {
    let init: Uint8Array | undefined;
    if (request.fmp4 && request.initUrl !== undefined) {
      [init] = await runSegments({ ...common, urls: [request.initUrl] });
    }
    const segments = await runSegments({
      ...common,
      urls: request.urls,
      onProgress: (progress) => {
        deps.emit({
          type: 'progress',
          segmentsDone: progress.segmentsDone,
          segmentsTotal: progress.segmentsTotal,
          bytesDone: progress.bytesDone,
        });
      },
    });
    if (job.signal.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    deps.emit({ type: 'assembling' });
    const mp4 =
      request.fmp4 && init !== undefined
        ? await assembleFmp4(init, segments)
        : await assembleTs(init, segments);
    if (isAborted(job.signal)) {
      return;
    }
    const blobUrl = URL.createObjectURL(
      new Blob([mp4 as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }),
    );
    deps.emit({ type: 'ready', blobUrl, bytes: mp4.byteLength });
  } catch (error) {
    if (isTooLarge()) {
      deps.emit({ type: 'failed', error: 'TOO_LARGE' });
    } else if (isAborted(deps.signal)) {
      return;
    } else {
      deps.emit({ type: 'failed', error: errorCode(error) });
    }
  } finally {
    deps.signal.removeEventListener('abort', relay);
  }
}
