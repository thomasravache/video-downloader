import type { PlaylistFetcherPort } from '../../src/core/ports';

/** Falha na busca de uma playlist (rede, status, limites). */
export class PlaylistFetchError extends Error {
  readonly code = 'HLS_FETCH_FAILED';
  constructor(message = 'HLS_FETCH_FAILED') {
    super(message);
    this.name = 'PlaylistFetchError';
  }
}

/** Relógio injetável para o timeout (SPEC-0011:IT-02). */
export interface PlaylistClock {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PlaylistFetcherOptions {
  clock?: PlaylistClock;
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'application/octet-stream',
]);

const realClock: PlaylistClock = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function isHttp(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function acceptedType(contentType: string | null): boolean {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return type.startsWith('text/') || ALLOWED_TYPES.has(type);
}

/** Lê o corpo contando os bytes; aborta ao passar do limite, mesmo sem Content-Length. */
async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new PlaylistFetchError('HLS_FETCH_FAILED: too_large');
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PlaylistFetchError('HLS_FETCH_FAILED: too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Fetcher real: 10 s, 1 MiB, redirecionamentos seguidos pelo navegador (URL final http(s)), só
 * http(s), só tipos de texto/m3u8. As mensagens de erro nunca carregam a URL (podem ter token).
 */
export function createPlaylistFetcher(options: PlaylistFetcherOptions = {}): PlaylistFetcherPort {
  const clock = options.clock ?? realClock;
  return {
    async fetchPlaylist(url) {
      if (!isHttp(url)) {
        throw new PlaylistFetchError('HLS_FETCH_FAILED: scheme');
      }
      const controller = new AbortController();
      const timer = clock.setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          credentials: 'include',
          redirect: 'follow',
          signal: controller.signal,
        });
        if (!isHttp(response.url)) {
          throw new PlaylistFetchError('HLS_FETCH_FAILED: final_scheme');
        }
        if (!response.ok) {
          throw new PlaylistFetchError(`HLS_FETCH_FAILED: status ${String(response.status)}`);
        }
        if (!acceptedType(response.headers.get('content-type'))) {
          throw new PlaylistFetchError('HLS_FETCH_FAILED: content_type');
        }
        return await readLimited(response);
      } catch (error) {
        if (error instanceof PlaylistFetchError) {
          throw error;
        }
        throw new PlaylistFetchError(
          `HLS_FETCH_FAILED: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      } finally {
        clock.clearTimeout(timer);
      }
    },
  };
}
