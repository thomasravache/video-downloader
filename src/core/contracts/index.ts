/** Contratos v1 (SPEC-0005): tipos das mensagens/providers e o schema de `provider.json`. */

export type Flavor = 'public' | 'local';

export interface ProviderManifest {
  id: string;
  flavors: Flavor[];
}

/** Retrato de um `<video>` coletado na página por `scripting.executeScript`. */
export interface VideoSnapshot {
  /** Atributo/propriedade `src` (já absoluto) ou null quando o vídeo usa `<source>`. */
  src: string | null;
  currentSrc: string;
  /** URLs absolutas dos `video > source[src]`. */
  sources: string[];
  /** `video.mediaKeys !== null`. */
  hasMediaKeys: boolean;
  /** Evento `encrypted` observado. */
  encrypted: boolean;
}

export interface PageSnapshot {
  pageUrl: string;
  pageTitle: string;
  videos: VideoSnapshot[];
  /** Origens 'https://host[:porta]' de `<iframe src>` http(s) com origem diferente da do frame (v2, SPEC-0009). */
  crossOriginFrames: string[];
}

/** Retrato de um frame da aba (v2, SPEC-0009); `frameId` 0 é o documento principal. */
export interface FrameSnapshot {
  frameId: number;
  snapshot: PageSnapshot;
}

/** Porta para o `scripting` do navegador: um retrato por frame com acesso; rejeita quando nenhum frame permite scripts. */
export interface ScriptingPort {
  collectVideos(tabId: number): Promise<FrameSnapshot[]>;
}

export interface VideoCandidate {
  id: string;
  providerId: string;
  tabId: number;
  pageUrl: string;
  mediaUrl: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  protection: 'none' | 'drm';
  support: 'downloadable' | 'unsupported-stream';
  /** Frame em que o vídeo foi visto (v2, SPEC-0009); 0 = principal. */
  frameId: number;
  frameUrl: string;
}

export interface DetectContext {
  tabId: number;
  pageUrl: string;
  scripting: ScriptingPort;
}

export interface Provider extends ProviderManifest {
  matches(url: URL): boolean;
  detect(ctx: DetectContext): Promise<VideoCandidate[]>;
}

export type DetectMessage = { type: 'detect'; tabId: number };
export type DownloadMessage = { type: 'download'; candidateId: string };
export type DiagnosticsMessage = { type: 'diagnostics' };
export type Message = DetectMessage | DownloadMessage | DiagnosticsMessage;

export interface LogEntry {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  correlationId: string;
  [field: string]: unknown;
}

/** Origens de iframe vistas na página e ainda sem permissão de host (v2, SPEC-0009). */
export interface DetectAccess {
  blockedOrigins: string[];
}

export type DetectResponse =
  | { ok: true; candidates: VideoCandidate[]; access: DetectAccess }
  | { ok: false; error: 'RESTRICTED_PAGE' | 'INVALID_MESSAGE' };

export type DetectResponseValidation =
  { ok: true; value: DetectResponse } | { ok: false; error: string };

/** Valida a resposta de `detect` v2 (SPEC-0009:CT-01). */
export function validateDetectResponse(_input: unknown): DetectResponseValidation {
  throw new Error('NotImplemented');
}

export type DownloadResponse =
  | { ok: true; downloadId: number }
  | { ok: false; error: 'CANDIDATE_NOT_FOUND' | 'PROTECTED' | 'UNSUPPORTED' | 'INVALID_MESSAGE' }
  | { ok: false; error: 'DOWNLOAD_FAILED'; reason: string };

export type DiagnosticsResponse =
  { ok: true; entries: LogEntry[] } | { ok: false; error: 'INVALID_MESSAGE' };

export type ManifestValidation =
  { ok: true; value: ProviderManifest } | { ok: false; error: string };

export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{2,}$/;
const FLAVORS: readonly Flavor[] = ['public', 'local'];

function isFlavor(value: unknown): value is Flavor {
  return FLAVORS.includes(value as Flavor);
}

/** Valida `provider.json`: `id` no formato `^[a-z][a-z0-9-]{2,}$` e `flavors` não vazio, só com 'public' | 'local'. */
export function validateProviderManifest(input: unknown): ManifestValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'provider.json deve ser um objeto' };
  }
  const { id, flavors } = input as { id?: unknown; flavors?: unknown };
  if (typeof id !== 'string' || !PROVIDER_ID_PATTERN.test(id)) {
    return { ok: false, error: `id inválido (use ${PROVIDER_ID_PATTERN.source})` };
  }
  if (!Array.isArray(flavors) || flavors.length === 0) {
    return { ok: false, error: 'flavors deve ser uma lista não vazia' };
  }
  const list: unknown[] = flavors;
  if (!list.every(isFlavor)) {
    return { ok: false, error: "flavors aceita apenas 'public' e 'local'" };
  }
  return { ok: true, value: { id, flavors: [...new Set(list)] } };
}
