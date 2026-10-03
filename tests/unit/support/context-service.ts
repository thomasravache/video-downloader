/**
 * Montagem do `createService` com portas falsas para os testes da SPEC-0016 (escada de busca). Não é teste.
 *
 *  - `playlists.fetchPlaylist(url)`: decidida por `respond(url, { leased, attempt })`; rejeita com
 *    `HLS_FETCH_FAILED: status N` (e `status` no objeto) para status != 200, como o fetcher real;
 *  - `requestContext.acquire(...)`: registra as chamadas e marca a regra como ativa até o `release`;
 *  - o candidato HLS chega pela rede (`onNetworkResponse`) com o `initiator` dado.
 */
import { vi } from 'vitest';
import { candidateId } from '../../../src/core/candidates';
import { createDiagnostics } from '../../../src/core/diagnostics';
import { NetworkStore } from '../../../src/core/network';
import type { RequestContextLease } from '../../../src/core/ports';
import { createService } from '../../../src/core/service';

export const SELF = 'abc';
export const MASTER_URL = 'https://cdn.exemplo.test/hls/media.m3u8';
export const INITIATOR = 'https://player.exemplo.test';

export const MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg0.ts
#EXT-X-ENDLIST
`;

export type Answer = number | string;

export interface ServiceOptions {
  /** Resposta por tentativa: número = status HTTP; string = corpo da playlist (200). */
  respond: (call: { url: string; leased: boolean; attempt: number }) => Answer;
  initiator?: string | undefined;
  /** `false`: sem `requestContext` (flavor public). */
  withContext?: boolean;
  /** Faz `acquire` rejeitar (regra recusada). */
  acquireFails?: boolean;
}

export function makeContextService(options: ServiceOptions) {
  const data = new Map<string, unknown>();
  const network = new NetworkStore({
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  });
  let leases = 0;
  const events: string[] = [];
  const acquire = vi.fn(
    (_opts: { hosts: string[]; origin: string }): Promise<RequestContextLease> => {
      if (options.acquireFails === true) {
        return Promise.reject(new Error('rule refused'));
      }
      leases += 1;
      events.push('acquire');
      let released = false;
      return Promise.resolve({
        release: () => {
          if (!released) {
            released = true;
            leases -= 1;
            events.push('release');
          }
          return Promise.resolve();
        },
      });
    },
  );
  const attempts = new Map<string, number>();
  const calls: { url: string; leased: boolean }[] = [];
  const fetchPlaylist = vi.fn((url: string): Promise<string> => {
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    const leased = leases > 0;
    calls.push({ url, leased });
    events.push(`fetch:${leased ? 'ctx' : 'plain'}`);
    const answer = options.respond({ url, leased, attempt });
    if (typeof answer === 'string') {
      return Promise.resolve(answer);
    }
    return Promise.reject(
      Object.assign(new Error(`HLS_FETCH_FAILED: status ${String(answer)}`), {
        code: 'HLS_FETCH_FAILED',
        status: answer,
      }),
    );
  });
  const diagnostics = createDiagnostics();
  const service = createService({
    extensionId: SELF,
    providers: [],
    scripting: { collectVideos: () => Promise.resolve([]) },
    downloads: { download: () => Promise.resolve(1) },
    tabs: { getUrl: () => Promise.resolve(undefined) },
    permissions: { contains: () => Promise.resolve(false), request: () => Promise.resolve(false) },
    diagnostics,
    network,
    playlists: { fetchPlaylist },
    ...(options.withContext !== false && { requestContext: { acquire } }),
  });

  async function observe(url: string = MASTER_URL): Promise<string> {
    await service.onNetworkResponse({
      url,
      method: 'GET',
      statusCode: 200,
      tabId: 1,
      frameId: 3,
      contentType: 'application/vnd.apple.mpegurl',
      ...(options.initiator !== undefined && { initiator: options.initiator }),
    });
    return candidateId(1, url);
  }

  async function resolve(url: string = MASTER_URL): Promise<unknown> {
    const id = await observe(url);
    return service.handle({ type: 'resolveHls', candidateId: id }, { id: SELF });
  }

  return {
    service,
    acquire,
    fetchPlaylist,
    calls,
    events,
    diagnostics,
    observe,
    resolve,
    leases: () => leases,
  };
}
