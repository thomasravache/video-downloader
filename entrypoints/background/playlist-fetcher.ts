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

/** Fetcher real: 10 s, 1 MiB, ≤ 3 redirecionamentos, só http(s), só tipos de texto/m3u8. */
export function createPlaylistFetcher(_options?: PlaylistFetcherOptions): PlaylistFetcherPort {
  throw new Error('NotImplemented');
}
