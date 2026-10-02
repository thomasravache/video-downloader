import type { MediaKind, VideoCandidate } from './contracts';

/** Abaixo disso, um `file` de tamanho conhecido é descartado (pixel, preview, fragmento). */
export const MIN_FILE_BYTES = 100 * 1024;
/** Máximo de itens guardados por aba. */
export const MAX_PER_TAB = 50;

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

const SEGMENT_EXTENSIONS = new Set(['ts', 'm4s', 'aac', 'm4a', 'mp3', 'vtt']);
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'avif',
  'ico',
  'bmp',
]);
const FILE_EXTENSIONS: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
};
const FILE_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
]);

/** Tipo de mídia sem parâmetros (`; charset=...`), em minúsculas. */
function mediaTypeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function extensionOf(pathname: string): string {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  return dot < 0 ? '' : last.slice(dot + 1).toLowerCase();
}

/** Transforma uma resposta em candidato `file`/`hls`/`dash` ou descarta (`null`). Pura e barata. */
export function classifyNetworkResponse(response: NetworkResponse): NetworkClassification | null {
  if (
    response.method !== 'GET' ||
    (response.statusCode !== 200 && response.statusCode !== 206) ||
    response.tabId < 0
  ) {
    return null;
  }
  let pathname: string;
  try {
    const url = new URL(response.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    pathname = url.pathname;
  } catch {
    return null;
  }
  const ext = extensionOf(pathname);
  const type = mediaTypeOf(response.contentType);
  if (SEGMENT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext) || type.startsWith('image/')) {
    return null;
  }
  if (HLS_TYPES.has(type) || ext === 'm3u8') {
    return { kind: 'hls' };
  }
  if (type === 'application/dash+xml' || ext === 'mpd') {
    return { kind: 'dash' };
  }

  const byType = FILE_TYPES.has(type);
  const byExtension =
    ext in FILE_EXTENSIONS && (type.startsWith('video/') || type === 'application/octet-stream');
  if (!byType && !byExtension) {
    return null;
  }
  const size = response.contentLength;
  if (size !== undefined && size < MIN_FILE_BYTES) {
    return null;
  }
  const mimeType = byType ? type : FILE_EXTENSIONS[ext];
  return {
    kind: 'file',
    ...(mimeType !== undefined && { mimeType }),
    ...(size !== undefined && { sizeBytes: size }),
  };
}

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash < 0 ? url : url.slice(0, hash);
}

interface StoredEntry {
  at: number;
  candidate: VideoCandidate;
}

const keyOf = (tabId: number): string => `vd:net:${String(tabId)}`;

/** Repositório por aba sobre `storage.session` (chave `vd:net:<tabId>`, máx. 50 itens). */
export class NetworkStore {
  /** Serializa leitura-modificação-escrita: eventos de rede chegam em rajadas. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly port: SessionStoragePort,
    readonly now: () => number = Date.now,
  ) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(tabId: number): Promise<StoredEntry[]> {
    const raw = await this.port.get(keyOf(tabId));
    return Array.isArray(raw) ? (raw as StoredEntry[]) : [];
  }

  add(tabId: number, candidate: VideoCandidate): Promise<void> {
    return this.serial(async () => {
      const key = withoutFragment(candidate.mediaUrl);
      const kept = (await this.read(tabId)).filter(
        (entry) => withoutFragment(entry.candidate.mediaUrl) !== key,
      );
      const next = [{ at: this.now(), candidate }, ...kept].slice(0, MAX_PER_TAB);
      await this.port.set(keyOf(tabId), next);
    });
  }

  /** Atualiza o candidato guardado (mesmo id) sem mudar a ordem; ausente é ignorado. */
  update(tabId: number, candidate: VideoCandidate): Promise<void> {
    return this.serial(async () => {
      const entries = await this.read(tabId);
      const at = entries.findIndex((entry) => entry.candidate.id === candidate.id);
      if (at < 0) {
        return;
      }
      const current = entries[at];
      if (current) {
        entries[at] = { at: current.at, candidate };
        await this.port.set(keyOf(tabId), entries);
      }
    });
  }

  /** Mais recentes primeiro. */
  forTab(tabId: number): Promise<VideoCandidate[]> {
    return this.serial(async () => (await this.read(tabId)).map((entry) => entry.candidate));
  }

  clear(tabId: number): Promise<void> {
    return this.serial(() => this.port.remove(keyOf(tabId)));
  }
}

/** DOM ∪ rede, sem repetir a mesma URL (sem fragmento); o candidato do DOM prevalece. */
export function mergeCandidates(
  dom: VideoCandidate[],
  network: VideoCandidate[],
): VideoCandidate[] {
  const seen = new Set<string>();
  const merged: VideoCandidate[] = [];
  for (const candidate of [...dom, ...network]) {
    const key = withoutFragment(candidate.mediaUrl);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(candidate);
    }
  }
  return merged;
}
