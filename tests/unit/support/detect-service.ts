/**
 * Ajudantes dos testes de detecção estável (SPEC-0024). Não é teste.
 *
 * Monta o `createService` real com o provider `generic`, uma `NetworkStore` sobre uma porta em memória
 * (imita `storage.session`, com clonagem estruturada) e o diagnóstico real; `collectVideos` é um dublê.
 */
import { vi } from 'vitest';
import type { PageSnapshot, VideoCandidate } from '../../../src/core/contracts';
import { createDiagnostics } from '../../../src/core/diagnostics';
import { NetworkStore } from '../../../src/core/network';
import type { NetworkResponse, SessionStoragePort } from '../../../src/core/network';
import { createService } from '../../../src/core/service';
import generic from '../../../src/providers/generic';

export const SELF = 'self-extension-id';
export const PAGE_URL = 'https://site.example.test/aula';

/** Porta em memória que imita storage.session: valores passam por clonagem estruturada. */
export function memoryPort(): SessionStoragePort & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key) => Promise.resolve(data.has(key) ? structuredClone(data.get(key)) : undefined),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  };
}

export function newStore(port: SessionStoragePort = memoryPort()): NetworkStore {
  let clock = 1_000;
  return new NetworkStore(port, () => ++clock);
}

export function pageWithVideo(src: string): PageSnapshot {
  return {
    pageUrl: PAGE_URL,
    pageTitle: 'Aula',
    videos: [{ src, currentSrc: src, sources: [], hasMediaKeys: false, encrypted: false }],
    crossOriginFrames: [],
  };
}

export function setupService(pageUrl: string = PAGE_URL) {
  const collectVideos = vi.fn();
  const diagnostics = createDiagnostics();
  const network = newStore();
  const service = createService({
    extensionId: SELF,
    providers: [generic],
    scripting: { collectVideos },
    downloads: { download: vi.fn().mockResolvedValue(1) },
    tabs: { getUrl: () => Promise.resolve(pageUrl) },
    permissions: {
      contains: () => Promise.resolve(false),
      request: () => Promise.resolve(false),
    },
    diagnostics,
    network,
  });
  return { service, collectVideos, diagnostics, network };
}

export function response(overrides: Partial<NetworkResponse> = {}): NetworkResponse {
  return {
    url: 'https://cdn.example.test/v/aula.mp4',
    method: 'GET',
    statusCode: 200,
    tabId: 1,
    frameId: 0,
    contentType: 'video/mp4',
    contentLength: 5 * 1024 * 1024,
    ...overrides,
  };
}

export const HLS_TYPE = 'application/vnd.apple.mpegurl';

export function candidate(
  tabId: number,
  mediaUrl: string,
  overrides: Partial<VideoCandidate> = {},
): VideoCandidate {
  return {
    id: `id-${String(tabId)}-${mediaUrl}`,
    providerId: 'network',
    tabId,
    pageUrl: '',
    mediaUrl,
    protection: 'none',
    support: 'downloadable',
    frameId: 0,
    frameUrl: '',
    kind: 'file',
    source: 'network',
    ...overrides,
  };
}
