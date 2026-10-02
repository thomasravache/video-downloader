/** Contratos v1 (SPEC-0005): tipos das mensagens/providers e o schema de `provider.json`. */

import { validateHlsInfo } from '../hls';
import type { HlsInfo } from '../hls';
import type { JobState } from '../hls-download/job';

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

/** Tipo de mídia do candidato (v3, SPEC-0010). */
export type MediaKind = 'file' | 'hls' | 'dash';

/** Origem do candidato: DOM da página ou observação de rede (v3, SPEC-0010). */
export type CandidateSource = 'dom' | 'network';

export interface VideoCandidate {
  id: string;
  providerId: string;
  tabId: number;
  pageUrl: string;
  mediaUrl: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** v4 (SPEC-0011): 'encrypted' = HLS com EXT-X-KEY. */
  protection: 'none' | 'drm' | 'encrypted';
  support: 'downloadable' | 'unsupported-stream';
  /** Frame em que o vídeo foi visto (v2, SPEC-0009); 0 = principal. */
  frameId: number;
  frameUrl: string;
  /** v3 (SPEC-0010). */
  kind: MediaKind;
  /** v3 (SPEC-0010). */
  source: CandidateSource;
  /** v4 (SPEC-0011): preenchido depois de `resolveHls`. */
  hls?: HlsInfo;
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
/** `variantIndex` (SPEC-0012): posição em `HlsInfo.variants`; padrão 0 (a maior). */
export type DownloadMessage = { type: 'download'; candidateId: string; variantIndex?: number };
export type DiagnosticsMessage = { type: 'diagnostics' };
export type ResolveHlsMessage = { type: 'resolveHls'; candidateId: string };
export type JobMessage = { type: 'job'; jobId: string };
export type CancelMessage = { type: 'cancel'; jobId: string };
export type Message =
  | DetectMessage
  | DownloadMessage
  | DiagnosticsMessage
  | ResolveHlsMessage
  | JobMessage
  | CancelMessage;

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

const HTTP_ORIGIN = /^https?:\/\/[^\s/?#]+$/i;

function isCandidate(value: unknown): value is VideoCandidate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' &&
    typeof c['providerId'] === 'string' &&
    typeof c['tabId'] === 'number' &&
    typeof c['pageUrl'] === 'string' &&
    typeof c['mediaUrl'] === 'string' &&
    (c['protection'] === 'none' || c['protection'] === 'drm' || c['protection'] === 'encrypted') &&
    (c['support'] === 'downloadable' || c['support'] === 'unsupported-stream') &&
    typeof c['frameId'] === 'number' &&
    Number.isInteger(c['frameId']) &&
    typeof c['frameUrl'] === 'string' &&
    (c['kind'] === 'file' || c['kind'] === 'hls' || c['kind'] === 'dash') &&
    (c['source'] === 'dom' || c['source'] === 'network') &&
    (c['hls'] === undefined || validateHlsInfo(c['hls']).ok)
  );
}

/** Valida a resposta de `detect` v3 (SPEC-0009:CT-01, SPEC-0010:CT-01). */
export function validateDetectResponse(input: unknown): DetectResponseValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'resposta deve ser um objeto' };
  }
  const { ok, error, candidates, access } = input as Record<string, unknown>;
  if (ok === false) {
    return error === 'RESTRICTED_PAGE' || error === 'INVALID_MESSAGE'
      ? { ok: true, value: { ok: false, error } }
      : { ok: false, error: 'error desconhecido' };
  }
  if (ok !== true) {
    return { ok: false, error: 'ok deve ser booleano' };
  }
  if (!Array.isArray(candidates) || !(candidates as unknown[]).every(isCandidate)) {
    return {
      ok: false,
      error:
        'candidates inválido (frameId inteiro, frameUrl, kind e source são obrigatórios; hls, se presente, deve ser um HlsInfo válido)',
    };
  }
  const blocked =
    typeof access === 'object' && access !== null
      ? (access as { blockedOrigins?: unknown }).blockedOrigins
      : undefined;
  if (
    !Array.isArray(blocked) ||
    !(blocked as unknown[]).every((o) => typeof o === 'string' && HTTP_ORIGIN.test(o))
  ) {
    return { ok: false, error: 'access.blockedOrigins deve ser uma lista de origens http(s)' };
  }
  return {
    ok: true,
    value: {
      ok: true,
      candidates: candidates as VideoCandidate[],
      access: { blockedOrigins: blocked as string[] },
    },
  };
}

export type DownloadResponse =
  | { ok: true; downloadId: number }
  /** HLS (SPEC-0012): começou um job. */
  | { ok: true; jobId: string }
  | { ok: false; error: 'CANDIDATE_NOT_FOUND' | 'PROTECTED' | 'UNSUPPORTED' | 'INVALID_MESSAGE' }
  | {
      ok: false;
      error: 'HLS_NOT_RESOLVED' | 'ENCRYPTED' | 'LIVE' | 'JOB_ALREADY_RUNNING' | 'TOO_MANY_JOBS';
    }
  | { ok: false; error: 'DOWNLOAD_FAILED'; reason: string };

export type JobResponse =
  { ok: true; job: JobState } | { ok: false; error: 'JOB_NOT_FOUND' | 'INVALID_MESSAGE' };

export type CancelResponse =
  { ok: true } | { ok: false; error: 'JOB_NOT_FOUND' | 'INVALID_MESSAGE' };

export type ResolveHlsResponse =
  | { ok: true; hls: HlsInfo }
  | {
      ok: false;
      error: 'CANDIDATE_NOT_FOUND' | 'HLS_FETCH_FAILED' | 'HLS_PARSE_FAILED' | 'INVALID_MESSAGE';
    };

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
