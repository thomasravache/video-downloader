/** Execução de um job no offscreen (SPEC-0012); sem `chrome.*`: tudo entra por `deps`. */
import {
  AssemblyError,
  MAX_BUFFERED_BYTES,
  SegmentFetchError,
  runSegments,
} from '../../src/core/hls-download';
import type {
  ByteRange,
  JobError,
  OffscreenEvent,
  OffscreenStart,
} from '../../src/core/hls-download';
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

const rangeHeader = ({ offset, length }: ByteRange): string =>
  `bytes=${String(offset)}-${String(offset + length - 1)}`;

/** `206` com `Content-Range: bytes <offset>-<fim>/<total|*>` exatamente igual ao pedido. */
function contentRangeMatches(response: Response, { offset, length }: ByteRange): boolean {
  if (response.status !== 206) {
    return false;
  }
  const match = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/.exec(
    response.headers.get('content-range')?.trim() ?? '',
  );
  return match !== null && Number(match[1]) === offset && Number(match[2]) === offset + length - 1;
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

  async function fetchBytes(
    url: string,
    init: { signal: AbortSignal },
    range?: ByteRange,
  ): Promise<Uint8Array> {
    const id = requestId++;
    inFlight.set(id, 0);
    try {
      const response = await deps.fetch(url, {
        signal: init.signal,
        credentials: 'include',
        ...(range && { headers: { Range: rangeHeader(range) } }),
      });
      if (!response.ok) {
        throw new Error('status');
      }
      // Com Range só vale 206 com Content-Range igual ao pedido: 200 (Range ignorado) ou outro
      // intervalo não é o trecho, e usá-lo corromperia o arquivo.
      if (range && !contentRangeMatches(response, range)) {
        throw new Error('range');
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
      if (range && received !== range.length) {
        throw new Error('range length');
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
    sleep: deps.sleep ?? realSleep,
    signal: job.signal,
  };

  try {
    // Limite decidido pelos metadados, antes da primeira requisição de mídia (inclui o init).
    const declared =
      (request.ranges ?? []).reduce((sum, range) => sum + (range?.length ?? 0), 0) +
      (request.initRange?.length ?? 0);
    if (declared > MAX_BUFFERED_BYTES) {
      flags.tooLarge = true;
      throw new AssemblyError('TOO_LARGE');
    }
    let init: Uint8Array | undefined;
    if (request.fmp4 && request.initUrl !== undefined) {
      [init] = await runSegments({
        ...common,
        fetch: (url, options) => fetchBytes(url, options, request.initRange),
        urls: [request.initUrl],
      });
    }
    const segments = await runSegments({
      ...common,
      fetch: (url, options) =>
        fetchBytes(url, options, request.ranges?.[options.index] ?? undefined),
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
