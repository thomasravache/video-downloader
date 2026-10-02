import type { MediaKind, VideoCandidate } from './contracts';

/** Resposta de rede observada por `webRequest.onResponseStarted` (SPEC-0010). */
export interface NetworkResponse {
  url: string;
  method: string;
  statusCode: number;
  tabId: number;
  frameId: number;
  contentType?: string;
  /** De Content-Length ou do total de Content-Range. */
  contentLength?: number;
}

export interface NetworkClassification {
  kind: MediaKind;
  mimeType?: string;
  sizeBytes?: number;
}

/** Porta para `browser.storage.session` (ADR-0006: só em memória do navegador). */
export interface SessionStoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Transforma uma resposta em candidato `file`/`hls`/`dash` ou descarta (`null`). */
export function classifyNetworkResponse(_response: NetworkResponse): NetworkClassification | null {
  throw new Error('NotImplemented');
}

/** Repositório por aba sobre `storage.session` (chave `vd:net:<tabId>`, máx. 50 itens). */
export class NetworkStore {
  constructor(
    readonly port: SessionStoragePort,
    readonly now: () => number = Date.now,
  ) {}

  add(_tabId: number, _candidate: VideoCandidate): Promise<void> {
    return Promise.reject(new Error('NotImplemented'));
  }

  forTab(_tabId: number): Promise<VideoCandidate[]> {
    return Promise.reject(new Error('NotImplemented'));
  }

  clear(_tabId: number): Promise<void> {
    return Promise.reject(new Error('NotImplemented'));
  }
}

/** DOM ∪ rede, sem repetir a mesma URL (sem fragmento); o candidato do DOM prevalece. */
export function mergeCandidates(
  _dom: VideoCandidate[],
  _network: VideoCandidate[],
): VideoCandidate[] {
  throw new Error('NotImplemented');
}
