/** Execução de um job no offscreen (SPEC-0012); sem `chrome.*`: tudo entra por `deps`. */
import {
  AssemblyError,
  MAX_BUFFERED_BYTES,
  MAX_MERGE_BUFFERED_BYTES,
  SegmentFetchError,
  runSegments,
} from '../../src/core/hls-download';
import type {
  ByteRange,
  JobError,
  OffscreenEvent,
  OffscreenStart,
} from '../../src/core/hls-download';
import { assembleFmp4, assembleTs, initIsEncrypted } from './assemble';

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

/** Forma comum às duas trilhas do `start` (vídeo no nível do comando, áudio em `audio`). */
interface TrackRequest {
  urls: string[];
  initUrl?: string | undefined;
  ranges?: (ByteRange | null | undefined)[] | undefined;
  initRange?: ByteRange | undefined;
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
  // Com áudio a junção guarda mais cópias: o limite vale para a soma das duas trilhas (SPEC-0014).
  const limit = request.audio === undefined ? MAX_BUFFERED_BYTES : MAX_MERGE_BUFFERED_BYTES;
  const isTooLarge = (): boolean => flags.tooLarge;
  const buffered = (): number => completedBytes + [...inFlight.values()].reduce((a, b) => a + b, 0);
  const checkLimit = (): void => {
    if (!flags.tooLarge && buffered() > limit) {
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
          if (range && received > range.length) {
            // Servidor hostil/defeituoso: mais bytes que a faixa pedida; não lê até o fim nem até o limite.
            await reader.cancel().catch(() => undefined);
            throw new Error('range length');
          }
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

  const emitReady = (mp4: Uint8Array): void => {
    const blobUrl = URL.createObjectURL(
      new Blob([mp4 as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }),
    );
    deps.emit({ type: 'ready', blobUrl, bytes: mp4.byteLength });
  };

  try {
    // Limite decidido pelos metadados, antes da primeira requisição de mídia (inclui os inits).
    const sumRanges = (ranges: OffscreenStart['ranges'], initRange?: ByteRange): number =>
      (ranges ?? []).reduce((sum, range) => sum + (range?.length ?? 0), initRange?.length ?? 0);
    const declared =
      sumRanges(request.ranges, request.initRange) +
      sumRanges(request.audio?.ranges, request.audio?.initRange);
    if (declared > limit) {
      flags.tooLarge = true;
      throw new AssemblyError('TOO_LARGE');
    }
    const { audio } = request;
    const total = request.urls.length + (audio?.urls.length ?? 0);
    const fetchInit = async (track: TrackRequest): Promise<Uint8Array | undefined> => {
      if (track.initUrl === undefined) {
        return undefined;
      }
      const [bytes] = await runSegments({
        ...common,
        fetch: (url, options) => fetchBytes(url, options, track.initRange),
        urls: [track.initUrl],
      });
      return bytes;
    };
    const fetchTrack = (track: TrackRequest, doneBefore: number): Promise<Uint8Array[]> =>
      runSegments({
        ...common,
        fetch: (url, options) =>
          fetchBytes(url, options, track.ranges?.[options.index] ?? undefined),
        urls: track.urls,
        onProgress: (progress) => {
          deps.emit({
            type: 'progress',
            segmentsDone: doneBefore + progress.segmentsDone,
            segmentsTotal: total,
            bytesDone: completedBytes,
          });
        },
      });

    const videoInit = request.fmp4 ? await fetchInit(request) : undefined;
    if (audio !== undefined) {
      if (videoInit === undefined || audio.initUrl === undefined) {
        throw new AssemblyError('ASSEMBLY_FAILED', 'junção exige fMP4 nas duas trilhas');
      }
      const audioInit = (await fetchInit(audio)) as Uint8Array;
      if (initIsEncrypted(videoInit) || initIsEncrypted(audioInit)) {
        throw new AssemblyError('ENCRYPTED', 'init com caixa de criptografia');
      }
      // Cada trilha vira um Blob assim que baixada; os pedaços em memória são soltos (sem cópia extra).
      const videoBlob = new Blob([videoInit, ...(await fetchTrack(request, 0))] as BlobPart[]);
      const audioBlob = new Blob([
        audioInit,
        ...(await fetchTrack(audio, request.urls.length)),
      ] as BlobPart[]);
      if (job.signal.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      deps.emit({ type: 'assembling' });
      // Importação dinâmica: a biblioteca de mídia só carrega quando há áudio separado (ADR-0014).
      const { assembleMerged } = await import('./merge');
      const merged = await assembleMerged({ blob: videoBlob }, { blob: audioBlob });
      if (isAborted(job.signal)) {
        return;
      }
      emitReady(merged);
      return;
    }
    const segments = await fetchTrack(request, 0);
    if (job.signal.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    deps.emit({ type: 'assembling' });
    const mp4 =
      request.fmp4 && videoInit !== undefined
        ? await assembleFmp4(videoInit, segments)
        : await assembleTs(videoInit, segments);
    if (isAborted(job.signal)) {
      return;
    }
    emitReady(mp4);
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
