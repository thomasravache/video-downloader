import { candidateId, createCandidateStore } from './candidates';
import type { CandidateStore } from './candidates';
import type {
  DetectResponse,
  FrameSnapshot,
  CancelResponse,
  DiagnosticsResponse,
  DownloadResponse,
  JobResponse,
  ResolveHlsResponse,
  Provider,
  VideoCandidate,
} from './contracts';
import { redactUrls } from './diagnostics';
import type { Diagnostics } from './diagnostics';
import { toFilename } from './filename';
import { HlsParseError, parseHlsPlaylist } from './hls';
import type { HlsInfo } from './hls';
import { chooseAudio, createJobManager, parseMediaSegments } from './hls-download';
import type { JobManager, MediaSegments } from './hls-download';
import { computeBlockedOrigins, originOf } from './frames';
import { validateMessage } from './messages';
import { classifyNetworkResponse, mergeCandidates } from './network';
import type { NetworkResponse, NetworkStore } from './network';
import type {
  DownloadPort,
  JobStoragePort,
  OffscreenPort,
  PermissionsPort,
  PlaylistFetcherPort,
  ScriptingPort,
  TabsPort,
} from './ports';

export type ServiceResponse =
  | DetectResponse
  | DownloadResponse
  | DiagnosticsResponse
  | ResolveHlsResponse
  | JobResponse
  | CancelResponse;

export interface ServiceDeps {
  extensionId: string;
  /** Ordem do registro: providers específicos antes de `generic`. */
  providers: readonly Provider[];
  scripting: ScriptingPort;
  downloads: DownloadPort;
  tabs: TabsPort;
  permissions: PermissionsPort;
  diagnostics: Diagnostics;
  store?: CandidateStore;
  /** Repositório de candidatos vistos na rede (SPEC-0010); sem ele, só o DOM conta. */
  network?: NetworkStore;
  /** Busca de playlists HLS (SPEC-0011). */
  playlists?: PlaylistFetcherPort;
  /** Jobs de download HLS (SPEC-0012): estado em `storage.session` e documento offscreen. */
  jobStore?: JobStoragePort;
  offscreen?: OffscreenPort;
}

export interface Service {
  handle(message: unknown, sender: { id?: string }): Promise<ServiceResponse>;
  /** `tabs.onRemoved`: descarta o estado da aba. */
  onTabRemoved(tabId: number): void;
  /** `webRequest.onResponseStarted`: classifica e, se aceita, grava na lista da aba (SPEC-0010). */
  onNetworkResponse(response: NetworkResponse): Promise<void>;
  /** Navegação do frame principal ou aba fechada: descarta a lista de rede da aba. */
  clearNetwork(tabId: number): Promise<void>;
  /** Mensagem `{target:'background'}` do offscreen (SPEC-0012); `false` quando ignorada. */
  onOffscreenMessage(message: unknown, sender: { id?: string; url?: string }): Promise<boolean>;
  /** `downloads.onChanged` (SPEC-0012): conclui ou falha o job em `saving`. */
  onDownloadChanged(delta: {
    id: number;
    state?: { current?: string };
    error?: { current?: string };
  }): Promise<void>;
}

type PlaylistRead =
  | { ok: true; info: HlsInfo }
  | { ok: false; error: 'HLS_FETCH_FAILED' | 'HLS_PARSE_FAILED'; reason?: string };

function stripQuery(url: string): string {
  return redactUrls(url);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Casos de uso do background (detect, download, diagnostics) sobre portas — sem APIs de navegador. */
export function createService(deps: ServiceDeps): Service {
  const { diagnostics } = deps;
  const store = deps.store ?? createCandidateStore();
  /** candidateId -> correlationId da detecção que o produziu (atravessa detect -> download). */
  const correlations = new Map<string, string>();
  const jobs: JobManager | undefined =
    deps.jobStore && deps.offscreen
      ? createJobManager({
          store: deps.jobStore,
          offscreen: deps.offscreen,
          downloads: deps.downloads,
          diagnostics,
          extensionId: deps.extensionId,
        })
      : undefined;

  /** ⋃ crossOriginFrames − origem do frame principal − origens com permissão (`permissions.contains`). */
  async function findBlockedOrigins(
    frames: readonly FrameSnapshot[],
    tabUrl: string,
  ): Promise<string[]> {
    const main = frames.find((frame) => frame.frameId === 0);
    const pageOrigin = originOf(main?.snapshot.pageUrl ?? tabUrl) ?? '';
    const seen = [...new Set(frames.flatMap((frame) => frame.snapshot.crossOriginFrames))];
    const granted = new Set<string>();
    await Promise.all(
      seen.map(async (origin) => {
        if (origin === pageOrigin) {
          return;
        }
        const has = await deps.permissions.contains([`${origin}/*`]).catch(() => false);
        if (has) {
          granted.add(origin);
        }
      }),
    );
    return computeBlockedOrigins(seen, pageOrigin, granted);
  }

  async function detect(tabId: number, correlationId: string): Promise<DetectResponse> {
    const pageUrl = (await deps.tabs.getUrl(tabId).catch(() => undefined)) ?? '';
    diagnostics.log('info', 'detect.start', correlationId, { tabId, pageUrl });

    let url: URL;
    try {
      url = new URL(pageUrl);
    } catch {
      url = new URL('about:blank');
    }
    const matching = deps.providers.filter((provider) => {
      try {
        return provider.matches(url);
      } catch {
        return false;
      }
    });

    // Um único `executeScript` por detecção: os providers compartilham o resultado e o service
    // reaproveita os frames para calcular as origens bloqueadas.
    let collected: Promise<FrameSnapshot[]> | undefined;
    const scripting: ScriptingPort = {
      collectVideos: (id) => (collected ??= deps.scripting.collectVideos(id)),
    };

    const found = new Map<string, VideoCandidate>();
    let failures = 0;
    for (const provider of matching) {
      try {
        const candidates = await provider.detect({ tabId, pageUrl, scripting });
        diagnostics.count(provider.id, 'detections');
        for (const candidate of candidates) {
          if (!found.has(candidate.id)) {
            found.set(candidate.id, candidate);
          }
        }
      } catch (error) {
        failures += 1;
        diagnostics.log('warn', 'detect.provider_failed', correlationId, {
          tabId,
          providerId: provider.id,
          reason: reasonOf(error),
        });
      }
    }

    if (failures > 0 && failures === matching.length) {
      diagnostics.log('warn', 'detect.restricted', correlationId, { tabId });
      return { ok: false, error: 'RESTRICTED_PAGE' };
    }

    const networkCandidates = await (deps.network?.forTab(tabId) ?? Promise.resolve([])).catch(
      (error: unknown) => {
        diagnostics.log('warn', 'detect.network_failed', correlationId, {
          tabId,
          reason: reasonOf(error),
        });
        return [] as VideoCandidate[];
      },
    );
    const candidates = mergeCandidates(
      [...found.values()],
      networkCandidates.map((c) => ({ ...c, pageUrl, frameUrl: pageUrl })),
    );
    store.replaceTab(tabId, candidates);
    for (const candidate of candidates) {
      correlations.set(candidate.id, correlationId);
    }
    diagnostics.log('info', 'detect.done', correlationId, {
      tabId,
      count: candidates.length,
      candidates: candidates.map((c) => ({
        providerId: c.providerId,
        mediaUrl: stripQuery(c.mediaUrl),
        protection: c.protection,
        support: c.support,
        kind: c.kind,
        source: c.source,
      })),
    });
    const frames = await collected?.catch((): FrameSnapshot[] => []);
    const blockedOrigins = await findBlockedOrigins(frames ?? [], pageUrl);
    diagnostics.log('info', 'detect.frames', correlationId, {
      tabId,
      frames: frames?.length ?? 0,
      blockedOrigins,
    });
    return { ok: true, candidates, access: { blockedOrigins } };
  }

  /** Memória primeiro; depois o `NetworkStore` (o service worker pode ter reiniciado sem `detect`). */
  async function findCandidate(candidateId: string): Promise<VideoCandidate | undefined> {
    const known = store.find(candidateId);
    if (known) {
      return known;
    }
    return deps.network?.find(candidateId).catch(() => undefined);
  }

  async function download(
    candidateId: string,
    variantIndex: number | undefined,
    audioIndex: number | undefined,
    fallbackId: string,
  ): Promise<DownloadResponse> {
    const correlationId = correlations.get(candidateId) ?? fallbackId;
    const candidate = await findCandidate(candidateId);
    if (!candidate) {
      diagnostics.log('warn', 'download.not_found', correlationId, { candidateId });
      return { ok: false, error: 'CANDIDATE_NOT_FOUND' };
    }
    const fields = {
      candidateId,
      providerId: candidate.providerId,
      mediaUrl: stripQuery(candidate.mediaUrl),
    };
    // Segurança no servidor, nesta ordem: DRM, criptografia, ao vivo (SPEC-0012 §3).
    if (candidate.protection === 'drm') {
      diagnostics.log('warn', 'download.protected', correlationId, fields);
      return { ok: false, error: 'PROTECTED' };
    }
    if (candidate.kind === 'hls') {
      return downloadHls(candidate, variantIndex, audioIndex, correlationId, fields);
    }
    if (candidate.support !== 'downloadable') {
      diagnostics.log('warn', 'download.unsupported', correlationId, fields);
      return { ok: false, error: 'UNSUPPORTED' };
    }

    const filename = toFilename({
      title: candidate.title,
      mediaUrl: candidate.mediaUrl,
      mimeType: candidate.mimeType,
    });
    try {
      const downloadId = await deps.downloads.download({ url: candidate.mediaUrl, filename });
      diagnostics.count(candidate.providerId, 'downloadsStarted');
      diagnostics.log('info', 'download.started', correlationId, {
        ...fields,
        filename,
        downloadId,
      });
      return { ok: true, downloadId };
    } catch (error) {
      const reason = reasonOf(error);
      diagnostics.count(candidate.providerId, 'downloadsFailed');
      diagnostics.log('error', 'download.failed', correlationId, { ...fields, filename, reason });
      return { ok: false, error: 'DOWNLOAD_FAILED', reason: redactUrls(reason) };
    }
  }

  function isHttp(url: string): boolean {
    try {
      const { protocol } = new URL(url);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }

  /** Busca e interpreta uma playlist; falha de rede vira `fetch`, texto inválido vira `parse`. */
  async function readPlaylist(url: string): Promise<PlaylistRead> {
    let text: string;
    try {
      if (!deps.playlists || !isHttp(url)) {
        throw new Error('playlist indisponível');
      }
      text = await deps.playlists.fetchPlaylist(url);
    } catch (error) {
      return { ok: false, error: 'HLS_FETCH_FAILED', reason: reasonOf(error) };
    }
    try {
      return { ok: true, info: parseHlsPlaylist(text, url) };
    } catch (error) {
      return {
        ok: false,
        error: 'HLS_PARSE_FAILED',
        ...(error instanceof HlsParseError ? {} : { reason: reasonOf(error) }),
      };
    }
  }

  type HlsRefusal = Extract<DownloadResponse, { ok: false }>;

  type ApprovedPlaylist =
    { ok: true; media: MediaSegments } | { ok: false; error: HlsRefusal['error']; event: string };

  /** Busca e aprova uma playlist de mídia (allowlist de criptografia, ao vivo, http(s), byte range). */
  async function approvePlaylist(url: string): Promise<ApprovedPlaylist> {
    const notResolved = {
      ok: false,
      error: 'HLS_NOT_RESOLVED',
      event: 'download.not_resolved',
    } as const;
    let text: string;
    try {
      if (!deps.playlists || !isHttp(url)) {
        throw new Error('playlist indisponível');
      }
      text = await deps.playlists.fetchPlaylist(url);
    } catch {
      return notResolved;
    }
    try {
      const info = parseHlsPlaylist(text, url);
      if (info.encrypted) {
        return { ok: false, error: 'ENCRYPTED', event: 'download.encrypted' };
      }
      if (info.type !== 'media') {
        return notResolved;
      }
      if (info.live) {
        return { ok: false, error: 'LIVE', event: 'download.live' };
      }
      return { ok: true, media: parseMediaSegments(text, url) };
    } catch {
      return notResolved;
    }
  }

  /**
   * Download de HLS (SPEC-0012). Nunca confia no estado guardado: re-busca e re-analisa a playlist da
   * variante escolhida (mesma função de lista de permissão da SPEC-0011) e recusa criptografia/ao vivo.
   */
  async function downloadHls(
    candidate: VideoCandidate,
    variantIndex: number | undefined,
    audioIndex: number | undefined,
    correlationId: string,
    fields: Record<string, unknown>,
  ): Promise<DownloadResponse> {
    const refuse = (error: HlsRefusal['error'], event: string): DownloadResponse => {
      diagnostics.log('warn', event, correlationId, { ...fields, error });
      return { ok: false, error } as HlsRefusal;
    };
    if (!jobs) {
      return refuse('UNSUPPORTED', 'download.unsupported');
    }
    const { hls } = candidate;
    // Candidato sem `hls` é desconhecido: nunca é assumido limpo (o popup resolve antes de baixar).
    if (candidate.protection === 'encrypted') {
      return refuse('ENCRYPTED', 'download.encrypted');
    }
    if (hls === undefined) {
      return refuse('HLS_NOT_RESOLVED', 'download.not_resolved');
    }
    if (hls.encrypted) {
      return refuse('ENCRYPTED', 'download.encrypted');
    }
    if (hls.live) {
      return refuse('LIVE', 'download.live');
    }

    let playlistUrl = candidate.mediaUrl;
    let label = 'original';
    const chosen = variantIndex ?? 0;
    if (hls.type === 'master') {
      const variant = hls.variants[chosen];
      if (!variant) {
        return refuse('UNSUPPORTED', 'download.unsupported');
      }
      playlistUrl = variant.url;
      label = variant.label;
    }
    if (!isHttp(playlistUrl)) {
      return refuse('HLS_NOT_RESOLVED', 'download.not_resolved');
    }

    // Faixa de áudio separada (SPEC-0014): `invalid` (índice de outro grupo/inexistente) é recusado.
    const audioTrack = chooseAudio(hls, chosen, audioIndex);
    if (audioTrack === 'invalid') {
      return refuse('UNSUPPORTED', 'download.unsupported');
    }

    // Re-busca as playlists envolvidas (vídeo e, se houver, áudio): são elas (não o master) que decidem,
    // e NENHUMA mídia é pedida antes de todas serem aprovadas.
    const approved = await approvePlaylist(playlistUrl);
    if (!approved.ok) {
      return refuse(approved.error, approved.event);
    }
    const media = approved.media;
    let audioMedia: MediaSegments | undefined;
    if (audioTrack !== 'none') {
      const approvedAudio = await approvePlaylist(audioTrack.url);
      if (!approvedAudio.ok) {
        return refuse(approvedAudio.error, approvedAudio.event);
      }
      audioMedia = approvedAudio.media;
      // A junção só trabalha com fMP4 nas duas pontas (SPEC-0014).
      if (!media.fmp4 || !audioMedia.fmp4) {
        return refuse('UNSUPPORTED', 'download.unsupported');
      }
    }

    const created = await jobs.create({
      candidateId: candidate.id,
      providerId: candidate.providerId,
      variantIndex: hls.type === 'master' ? chosen : 0,
      filename: toFilename({ title: candidate.title, label, mediaUrl: candidate.mediaUrl }),
      correlationId,
      urls: media.urls,
      ...(media.initUrl !== undefined && { initUrl: media.initUrl }),
      fmp4: media.fmp4,
      ...(media.ranges !== undefined && { ranges: media.ranges }),
      ...(media.initRange !== undefined && { initRange: media.initRange }),
      ...(audioMedia !== undefined && {
        audio: {
          urls: audioMedia.urls,
          ...(audioMedia.initUrl !== undefined && { initUrl: audioMedia.initUrl }),
          ...(audioMedia.ranges !== undefined && { ranges: audioMedia.ranges }),
          ...(audioMedia.initUrl !== undefined &&
            audioMedia.initRange !== undefined && { initRange: audioMedia.initRange }),
        },
      }),
    });
    if (!created.ok) {
      return refuse(created.error, 'download.refused');
    }
    diagnostics.count(candidate.providerId, 'downloadsStarted');
    return { ok: true, jobId: created.jobId };
  }

  async function resolveHlsOnce(
    candidateId: string,
    fallbackId: string,
  ): Promise<ResolveHlsResponse> {
    const correlationId = correlations.get(candidateId) ?? fallbackId;
    const candidate = await findCandidate(candidateId);
    if (candidate?.kind !== 'hls') {
      diagnostics.log('warn', 'hls.not_found', correlationId, { candidateId });
      return { ok: false, error: 'CANDIDATE_NOT_FOUND' };
    }
    const fields = { candidateId, mediaUrl: stripQuery(candidate.mediaUrl) };
    const fail = (
      error: 'HLS_FETCH_FAILED' | 'HLS_PARSE_FAILED',
      stage: 'playlist' | 'variant',
      reason?: string,
    ): ResolveHlsResponse => {
      diagnostics.countHls('failed');
      diagnostics.log('warn', 'hls.failed', correlationId, {
        ...fields,
        error,
        stage,
        ...(reason !== undefined && { reason: redactUrls(reason) }),
      });
      return { ok: false, error };
    };

    const first = await readPlaylist(candidate.mediaUrl);
    if (!first.ok) {
      return fail(first.error, 'playlist', first.reason);
    }
    let hls = first.info;
    const best = first.info.variants[0];
    if (first.info.type === 'master' && best) {
      const second = await readPlaylist(best.url);
      if (!second.ok) {
        return fail(second.error, 'variant', second.reason);
      }
      if (second.info.type !== 'media') {
        return fail('HLS_PARSE_FAILED', 'variant');
      }
      const { durationSec, segmentCount } = second.info;
      const { durationSec: _d, segmentCount: _s, ...master } = first.info;
      // SPEC-0014: a playlist de áudio padrão do grupo do melhor variante (1 busca extra, melhor esforço):
      // criptografada marca o candidato; falha não derruba o resolve nem muda encrypted/live.
      const defaultAudio = chooseAudio(first.info, 0);
      const audioRead =
        typeof defaultAudio === 'object' ? await readPlaylist(defaultAudio.url) : undefined;
      const audioEncrypted = audioRead?.ok === true && audioRead.info.encrypted;
      hls = {
        ...master,
        encrypted: first.info.encrypted || second.info.encrypted || audioEncrypted,
        live: second.info.live,
        fmp4: second.info.fmp4,
        ...(durationSec !== undefined && { durationSec }),
        ...(segmentCount !== undefined && { segmentCount }),
      };
    }

    const resolved: VideoCandidate = {
      ...candidate,
      hls,
      // Pela resolução mais recente: nunca deixa `encrypted` velho ao lado de `hls.encrypted: false`.
      ...(candidate.protection !== 'drm' && {
        protection: hls.encrypted ? ('encrypted' as const) : ('none' as const),
      }),
      // Pelo resolve mais recente; `drm` fica como está. Só o download de HLS (SPEC-0012) usa 'downloadable'.
      ...(candidate.protection !== 'drm' && {
        support:
          hls.live || hls.encrypted ? ('unsupported-stream' as const) : ('downloadable' as const),
      }),
    };
    store.update(resolved);
    try {
      await deps.network?.update(candidate.tabId, resolved);
    } catch (error) {
      diagnostics.log('warn', 'hls.store_failed', correlationId, {
        ...fields,
        reason: reasonOf(error),
      });
    }
    diagnostics.countHls('resolved');
    if (hls.encrypted) {
      diagnostics.countHls('encrypted');
    }
    if (hls.live) {
      diagnostics.countHls('live');
    }
    diagnostics.log('info', 'hls.resolved', correlationId, {
      ...fields,
      type: hls.type,
      variants: hls.variants.length,
      segmentCount: hls.segmentCount,
      encrypted: hls.encrypted,
      live: hls.live,
      fmp4: hls.fmp4,
    });
    return { ok: true, hls };
  }

  /** Resoluções simultâneas do mesmo candidato compartilham uma única busca. */
  const resolving = new Map<string, Promise<ResolveHlsResponse>>();
  function resolveHls(candidateId: string, fallbackId: string): Promise<ResolveHlsResponse> {
    let pending = resolving.get(candidateId);
    if (!pending) {
      pending = resolveHlsOnce(candidateId, fallbackId).finally(() => {
        resolving.delete(candidateId);
      });
      resolving.set(candidateId, pending);
    }
    return pending;
  }

  return {
    async handle(message, sender) {
      const correlationId = diagnostics.newCorrelationId();
      const validation = validateMessage(message, sender, deps.extensionId);
      if (!validation.ok) {
        diagnostics.log('warn', 'message.rejected', correlationId, {
          // O tipo nunca vem de dados do usuário que precisem ser preservados: só um rótulo curto.
          type: typeof message === 'object' && message !== null ? 'object' : typeof message,
          fromSelf: sender.id === deps.extensionId,
        });
        return { ok: false, error: 'INVALID_MESSAGE' };
      }
      const { message: valid } = validation;
      switch (valid.type) {
        case 'detect':
          return detect(valid.tabId, correlationId);
        case 'download':
          return download(valid.candidateId, valid.variantIndex, valid.audioIndex, correlationId);
        case 'diagnostics':
          return { ok: true, entries: diagnostics.snapshot() };
        case 'resolveHls':
          return resolveHls(valid.candidateId, correlationId);
        case 'job': {
          const job = await jobs?.get(valid.jobId);
          return job ? { ok: true, job } : { ok: false, error: 'JOB_NOT_FOUND' };
        }
        case 'cancel':
          return (await jobs?.cancel(valid.jobId))
            ? { ok: true }
            : { ok: false, error: 'JOB_NOT_FOUND' };
      }
    },
    onOffscreenMessage: (message, sender) =>
      jobs ? jobs.onOffscreenMessage(message, sender) : Promise.resolve(false),
    async onDownloadChanged(delta) {
      await jobs?.onDownloadChanged(delta);
    },
    async onNetworkResponse(response) {
      if (!deps.network) {
        return;
      }
      const classification = classifyNetworkResponse(response);
      if (!classification) {
        diagnostics.countNetwork('discarded');
        return;
      }
      const { kind, mimeType, sizeBytes } = classification;
      diagnostics.countNetwork(kind);
      diagnostics.log('debug', 'network.captured', diagnostics.newCorrelationId(), {
        tabId: response.tabId,
        kind,
        mediaUrl: stripQuery(response.url),
      });
      try {
        await deps.network.add(response.tabId, {
          id: candidateId(response.tabId, response.url),
          providerId: 'network',
          tabId: response.tabId,
          pageUrl: '',
          mediaUrl: response.url,
          ...(mimeType !== undefined && { mimeType }),
          ...(sizeBytes !== undefined && { sizeBytes }),
          protection: 'none',
          support: kind === 'file' ? 'downloadable' : 'unsupported-stream',
          frameId: response.frameId,
          frameUrl: '',
          kind,
          source: 'network',
        });
      } catch (error) {
        diagnostics.log('warn', 'network.store_failed', diagnostics.newCorrelationId(), {
          tabId: response.tabId,
          reason: reasonOf(error),
        });
      }
    },
    async clearNetwork(tabId) {
      try {
        await deps.network?.clear(tabId);
      } catch (error) {
        diagnostics.log('warn', 'network.clear_failed', diagnostics.newCorrelationId(), {
          tabId,
          reason: reasonOf(error),
        });
      }
    },
    onTabRemoved(tabId) {
      for (const candidate of store.forTab(tabId)) {
        correlations.delete(candidate.id);
      }
      store.removeTab(tabId);
    },
  };
}
