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
import type { EncryptionPlan } from '../../src/core/hls-download/protocol';
import { assembleFmp4, assembleTs, initIsEncrypted, transmuxTsToFmp4 } from './assemble';

async function getAes128Handler() {
  try {
    const mod = await import('virtual:aes128-decrypt');
    return mod.aes128Handler;
  } catch {
    return undefined;
  }
}

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

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function errorCode(error: unknown): JobError {
  if (error instanceof AssemblyError) {
    return error.code;
  }
  if (error instanceof SegmentFetchError) {
    return 'FETCH_FAILED';
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (code === 'KEY_FAILED') {
      return 'KEY_FAILED';
    }
    if (code === 'DECRYPT_FAILED') {
      return 'DECRYPT_FAILED';
    }
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

  let videoKeys: Map<number, CryptoKey> | undefined;
  let audioKeys: Map<number, CryptoKey> | undefined;

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

    const hasEncryption =
      request.encryption !== undefined || request.audio?.encryption !== undefined;
    const aes128Handler = hasEncryption ? await getAes128Handler() : undefined;

    const loadEncryptionKeys = async (
      encryption: EncryptionPlan | undefined,
    ): Promise<Map<number, CryptoKey>> => {
      const keysMap = new Map<number, CryptoKey>();
      if (!encryption) {
        return keysMap;
      }
      if (!aes128Handler) {
        throw new AssemblyError('ENCRYPTED');
      }
      const handler = aes128Handler;
      await Promise.all(
        encryption.keys.map(async (keyDef, index) => {
          let response: Response;
          try {
            response = await deps.fetch(keyDef.url, {
              signal: job.signal,
              credentials: 'include',
            });
          } catch (error) {
            if (isAborted(job.signal)) throw error;
            throw new handler.KeyFetchError(
              `falha ao buscar chave: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          if (!response.ok) {
            throw new handler.KeyFetchError(`HTTP ${String(response.status)}`);
          }
          const buf = await response.arrayBuffer();
          const bytes = new Uint8Array(buf);
          if (bytes.length !== 16) {
            throw new handler.KeyFetchError(
              `chave com tamanho inválido (${String(bytes.length)} bytes)`,
            );
          }
          const cryptoKey = await handler.loadKey(bytes);
          keysMap.set(index, cryptoKey);
        }),
      );
      return keysMap;
    };

    videoKeys = await loadEncryptionKeys(request.encryption);
    audioKeys = await loadEncryptionKeys(request.audio?.encryption);

    const { audio } = request;
    const total = request.urls.length + (audio?.urls.length ?? 0);
    const fetchInit = async (
      track: TrackRequest,
      encryption?: EncryptionPlan,
      cryptoKeys?: Map<number, CryptoKey>,
    ): Promise<Uint8Array | undefined> => {
      if (track.initUrl === undefined) {
        return undefined;
      }
      const [bytes] = await runSegments({
        ...common,
        fetch: (url, options) => fetchBytes(url, options, track.initRange),
        urls: [track.initUrl],
      });
      if (bytes && encryption?.initKey !== undefined && encryption.initKey !== null) {
        if (!aes128Handler) {
          throw new AssemblyError('ENCRYPTED');
        }
        const cryptoKey = cryptoKeys?.get(encryption.initKey);
        if (!cryptoKey) {
          throw new aes128Handler.KeyFetchError('chave do init não encontrada');
        }
        const keyDef = encryption.keys[encryption.initKey];
        if (!keyDef?.iv) {
          throw new AssemblyError('ENCRYPTED', 'init sem IV explícito');
        }
        const iv = hexToBytes(keyDef.iv);
        return await aes128Handler.decryptSegment(cryptoKey, iv, bytes, 'fmp4');
      }
      return bytes;
    };
    const fetchTrack = async (
      track: TrackRequest,
      doneBefore: number,
      encryption?: EncryptionPlan,
      cryptoKeys?: Map<number, CryptoKey>,
      type?: 'ts' | 'fmp4',
    ): Promise<Uint8Array[]> => {
      const rawSegments = await runSegments({
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
      if (!encryption) {
        return rawSegments;
      }
      if (!aes128Handler) {
        throw new AssemblyError('ENCRYPTED');
      }
      const decrypted = new Array<Uint8Array>(rawSegments.length);
      for (let i = 0; i < rawSegments.length; i++) {
        const raw = rawSegments[i] as Uint8Array;
        const keyIdx = encryption.segmentKeys[i];
        if (keyIdx === null || keyIdx === undefined) {
          decrypted[i] = raw;
          continue;
        }
        const cryptoKey = cryptoKeys?.get(keyIdx);
        if (!cryptoKey) {
          throw new aes128Handler.KeyFetchError('chave não encontrada');
        }
        const keyDef = encryption.keys[keyIdx];
        const iv = keyDef?.iv
          ? hexToBytes(keyDef.iv)
          : aes128Handler.deriveIv(encryption.mediaSequence, i);
        decrypted[i] = await aes128Handler.decryptSegment(cryptoKey, iv, raw, type);
      }
      return decrypted;
    };

    const videoInit = request.fmp4
      ? await fetchInit(request, request.encryption, videoKeys)
      : undefined;
    if (audio !== undefined) {
      if (request.fmp4 && videoInit === undefined) {
        throw new AssemblyError('ASSEMBLY_FAILED', 'faltou init de vídeo');
      }
      if (videoInit !== undefined && initIsEncrypted(videoInit)) {
        throw new AssemblyError('ENCRYPTED', 'init com caixa de criptografia');
      }
      let audioBlob: Blob;
      if (audio.initUrl !== undefined) {
        const audioInit = await fetchInit(audio, audio.encryption, audioKeys);
        if (audioInit === undefined) {
          throw new AssemblyError('ASSEMBLY_FAILED', 'faltou init de áudio');
        }
        if (initIsEncrypted(audioInit)) {
          throw new AssemblyError('ENCRYPTED', 'init com caixa de criptografia');
        }
        const audioSegments = await fetchTrack(
          audio,
          request.urls.length,
          audio.encryption,
          audioKeys,
          'fmp4',
        );
        audioBlob = new Blob([audioInit, ...audioSegments] as BlobPart[]);
      } else {
        const audioSegments = await fetchTrack(
          audio,
          request.urls.length,
          audio.encryption,
          audioKeys,
          'ts',
        );
        const isTs = audioSegments.length > 0 && audioSegments[0]?.[0] === 0x47;
        if (isTs) {
          const { initSegment, fragments } = await transmuxTsToFmp4(audioSegments);
          audioBlob = new Blob([initSegment, ...fragments] as BlobPart[]);
        } else {
          audioBlob = new Blob(audioSegments as BlobPart[]);
        }
      }
      const videoSegments = await fetchTrack(
        request,
        0,
        request.encryption,
        videoKeys,
        request.fmp4 ? 'fmp4' : 'ts',
      );
      let videoBlob: Blob;
      if (request.fmp4) {
        videoBlob =
          videoInit !== undefined
            ? new Blob([videoInit, ...videoSegments] as BlobPart[])
            : new Blob(videoSegments as BlobPart[]);
      } else {
        const { initSegment, fragments } = await transmuxTsToFmp4(videoSegments);
        videoBlob = new Blob([initSegment, ...fragments] as BlobPart[]);
      }
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
    const segments = await fetchTrack(
      request,
      0,
      request.encryption,
      videoKeys,
      request.fmp4 ? 'fmp4' : 'ts',
    );
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
    videoKeys?.clear();
    audioKeys?.clear();
    deps.signal.removeEventListener('abort', relay);
  }
}
