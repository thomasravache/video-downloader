import { groupKey } from './candidates';
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
  /** SPEC-0016: valor cru de `details.initiator` (origem do frame que fez a requisição). */
  initiator?: string;
  /** SPEC-0018: título da aba ativa no momento do evento de rede. */
  tabTitle?: string;
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
  /** Todas as chaves guardadas; permite achar um candidato sem conhecer a aba. */
  keys?(): Promise<string[]>;
}

const SEGMENT_EXTENSIONS = new Set(['ts', 'm4s', 'aac', 'm4a', 'mp3', 'vtt', 'webvtt']);
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
  mov: 'video/quicktime',
};
const FILE_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
/** D6: tipos genéricos aceitos para um arquivo com extensão de vídeo conhecida (`''` = sem Content-Type). */
const GENERIC_FILE_TYPES = new Set(['application/octet-stream', 'binary/octet-stream', '']);
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
  return response.tabId < 0 ? null : classifyMedia(response);
}

/**
 * Mesma regra de `classifyNetworkResponse` sem exigir aba: usada para a resposta do service worker do site
 * (`tabId = -1`), que só entra numa lista depois de `attributeTabs` (D8).
 */
export function classifyMedia(response: NetworkResponse): NetworkClassification | null {
  if (response.method !== 'GET' || (response.statusCode !== 200 && response.statusCode !== 206)) {
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
  const lowerUrl = response.url.toLowerCase();
  if (
    type === 'text/vtt' ||
    ext === 'vtt' ||
    ext === 'webvtt' ||
    lowerUrl.includes('textstream') ||
    lowerUrl.includes('subtitles')
  ) {
    return null;
  }
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
    ext in FILE_EXTENSIONS && (type.startsWith('video/') || GENERIC_FILE_TYPES.has(type));
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

/** Origem http(s) de uma URL; `undefined` para o resto. */
function httpOriginOf(url: string | undefined): string | undefined {
  if (typeof url !== 'string') {
    return undefined;
  }
  try {
    const { protocol, origin } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** D8: abas que recebem uma resposta sem aba (tabId = -1). Vazio quando initiator ausente/não http(s). */
export function attributeTabs(
  initiator: string | undefined,
  tabs: readonly { id: number; url?: string }[],
): number[] {
  const origin = httpOriginOf(initiator);
  if (origin === undefined) {
    return [];
  }
  return tabs.filter((tab) => tab.id >= 0 && httpOriginOf(tab.url) === origin).map((tab) => tab.id);
}

/** Diretório (origem + caminho até a última `/`) de uma URL http(s). */
function directoryOf(url: string): string | undefined {
  try {
    const { protocol, origin, pathname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') {
      return undefined;
    }
    return `${origin}${pathname.slice(0, pathname.lastIndexOf('/') + 1)}`;
  } catch {
    return undefined;
  }
}

/** D5: true quando `file` está na mesma origem e no diretório (ou subdiretório) de um manifesto hls/dash. */
export function isManifestSegment(
  file: VideoCandidate,
  manifests: readonly VideoCandidate[],
): boolean {
  const fileDir = directoryOf(file.mediaUrl);
  if (file.kind !== 'file' || fileDir === undefined) {
    return false;
  }
  return manifests.some((manifest) => {
    if (manifest.kind !== 'hls' && manifest.kind !== 'dash') {
      return false;
    }
    const dir = directoryOf(manifest.mediaUrl);
    return dir !== undefined && fileDir.startsWith(dir);
  });
}

/** D7: true quando a resposta de main_frame troca o documento (2xx exceto 204/205, sem Content-Disposition attachment). */
export function replacesDocument(details: {
  statusCode: number;
  responseHeaders?: { name: string; value?: string }[];
}): boolean {
  const { statusCode } = details;
  if (statusCode < 200 || statusCode > 299 || statusCode === 204 || statusCode === 205) {
    return false;
  }
  const disposition = details.responseHeaders?.find(
    (h) => h.name.toLowerCase() === 'content-disposition',
  )?.value;
  return !/^\s*attachment\b/i.test(disposition ?? '');
}

function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash < 0 ? url : url.slice(0, hash);
}

interface StoredEntry {
  at: number;
  candidate: VideoCandidate;
}

const KEY_PREFIX = 'vd:net:';
const keyOf = (tabId: number): string => `${KEY_PREFIX}${String(tabId)}`;
/** SPEC-0024: revisão da lista numa chave própria, para não mudar o formato de `vd:net:<tabId>`. */
const revisionKeyOf = (tabId: number): string => `vd:netrev:${String(tabId)}`;

/** D5: acima do teto saem primeiro os `file` mais antigos; manifestos só quando não sobra `file`. */
function evict(entries: StoredEntry[]): StoredEntry[] {
  const kept = [...entries];
  while (kept.length > MAX_PER_TAB) {
    const oldestFile = kept.findLastIndex((entry) => entry.candidate.kind === 'file');
    kept.splice(oldestFile < 0 ? kept.length - 1 : oldestFile, 1);
  }
  return kept;
}

/**
 * Repositório por aba sobre `storage.session` (chave `vd:net:<tabId>`, máx. 50 itens) e a revisão da
 * lista (`vd:netrev:<tabId>`, SPEC-0024).
 */
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
      const entries = await this.read(tabId);
      const previous = entries.find((entry) => withoutFragment(entry.candidate.mediaUrl) === key);
      const kept = entries.filter((entry) => entry !== previous);
      // Reobservar uma playlist já resolvida não pode apagar o que `resolveHls` descobriu.
      const { hls, protection, support } = previous?.candidate ?? {};
      const stored: VideoCandidate =
        hls && protection && support ? { ...candidate, hls, protection, support } : candidate;
      const next = evict([{ at: this.now(), candidate: stored }, ...kept]);
      await this.port.set(keyOf(tabId), next);
      // Reobservar a mesma URL (p.ex. as respostas 206 de um MP4 tocando) não muda a lista.
      if (!previous) {
        await this.bump(tabId);
      }
    });
  }

  private async readRevision(tabId: number): Promise<number> {
    const raw = await this.port.get(revisionKeyOf(tabId));
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
  }

  private async bump(tabId: number): Promise<void> {
    await this.port.set(revisionKeyOf(tabId), (await this.readRevision(tabId)) + 1);
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

  /** Acha um candidato pelo id em qualquer aba (o service worker pode ter reiniciado). */
  find(candidateId: string): Promise<VideoCandidate | undefined> {
    return this.serial(async () => {
      for (const key of (await this.port.keys?.()) ?? []) {
        if (!key.startsWith(KEY_PREFIX)) {
          continue;
        }
        const raw = await this.port.get(key);
        const entries = Array.isArray(raw) ? (raw as StoredEntry[]) : [];
        const found = entries.find((entry) => entry.candidate.id === candidateId);
        if (found) {
          return found.candidate;
        }
      }
      return undefined;
    });
  }

  /** Mais recentes primeiro. */
  forTab(tabId: number): Promise<VideoCandidate[]> {
    return this.serial(async () => (await this.read(tabId)).map((entry) => entry.candidate));
  }

  clear(tabId: number): Promise<void> {
    return this.serial(async () => {
      await this.port.remove(keyOf(tabId));
      await this.bump(tabId);
    });
  }

  /** Inteiro ≥ 0, incrementado a cada add efetivo e a cada clear da aba; 0 para aba sem histórico. */
  revision(tabId: number): Promise<number> {
    return this.serial(() => this.readRevision(tabId));
  }
}

/**
 * DOM ∪ rede, sem repetir a mesma URL (sem fragmento); o candidato do DOM prevalece, exceto um `file`
 * do DOM contra um `hls` da rede (a rede viu a playlist de verdade): vale para a mesma URL e, também,
 * para a mesma `groupKey` (origem + caminho + query sem assinatura, SPEC-0013/SPEC-0024 D9). O `hls` herda
 * o título do DOM.
 */
export function mergeCandidates(
  dom: VideoCandidate[],
  network: VideoCandidate[],
): VideoCandidate[] {
  const seen = new Map<string, number>();
  const merged: VideoCandidate[] = [];
  const isNetworkHls = (c: VideoCandidate): boolean => c.source === 'network' && c.kind === 'hls';
  const replace = (at: number, candidate: VideoCandidate): void => {
    const existing = merged[at];
    const title = existing?.title;
    const isDrm = existing?.protection === 'drm';
    merged[at] = {
      ...candidate,
      ...(candidate.title === undefined && title !== undefined ? { title } : {}),
      ...(isDrm ? { protection: 'drm' as const } : {}),
    };
  };
  for (const candidate of [...dom, ...network]) {
    const key = withoutFragment(candidate.mediaUrl);
    const at = seen.get(key);
    if (at === undefined) {
      if (isNetworkHls(candidate)) {
        const group = groupKey(candidate.mediaUrl);
        const file = merged.findIndex(
          (c) => c.kind === 'file' && c.source === 'dom' && groupKey(c.mediaUrl) === group,
        );
        if (file >= 0) {
          replace(file, candidate);
          seen.set(key, file);
          continue;
        }
      }
      seen.set(key, merged.length);
      merged.push(candidate);
    } else if (isNetworkHls(candidate) && merged[at]?.kind === 'file') {
      replace(at, candidate);
    }
  }
  return merged;
}
