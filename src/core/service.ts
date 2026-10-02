import { candidateId, createCandidateStore } from './candidates';
import type { CandidateStore } from './candidates';
import type {
  DetectResponse,
  FrameSnapshot,
  DiagnosticsResponse,
  DownloadResponse,
  Provider,
  VideoCandidate,
} from './contracts';
import { redactUrls } from './diagnostics';
import type { Diagnostics } from './diagnostics';
import { toFilename } from './filename';
import { computeBlockedOrigins, originOf } from './frames';
import { validateMessage } from './messages';
import { classifyNetworkResponse, mergeCandidates } from './network';
import type { NetworkResponse, NetworkStore } from './network';
import type { DownloadPort, PermissionsPort, ScriptingPort, TabsPort } from './ports';

export type ServiceResponse = DetectResponse | DownloadResponse | DiagnosticsResponse;

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
}

export interface Service {
  handle(message: unknown, sender: { id?: string }): Promise<ServiceResponse>;
  /** `tabs.onRemoved`: descarta o estado da aba. */
  onTabRemoved(tabId: number): void;
  /** `webRequest.onResponseStarted`: classifica e, se aceita, grava na lista da aba (SPEC-0010). */
  onNetworkResponse(response: NetworkResponse): Promise<void>;
  /** Navegação do frame principal ou aba fechada: descarta a lista de rede da aba. */
  clearNetwork(tabId: number): Promise<void>;
}

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

  async function download(candidateId: string, fallbackId: string): Promise<DownloadResponse> {
    const correlationId = correlations.get(candidateId) ?? fallbackId;
    const candidate = store.find(candidateId);
    if (!candidate) {
      diagnostics.log('warn', 'download.not_found', correlationId, { candidateId });
      return { ok: false, error: 'CANDIDATE_NOT_FOUND' };
    }
    const fields = {
      candidateId,
      providerId: candidate.providerId,
      mediaUrl: stripQuery(candidate.mediaUrl),
    };
    if (candidate.protection === 'drm') {
      diagnostics.log('warn', 'download.protected', correlationId, fields);
      return { ok: false, error: 'PROTECTED' };
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
          return download(valid.candidateId, correlationId);
        case 'diagnostics':
          return { ok: true, entries: diagnostics.snapshot() };
      }
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
