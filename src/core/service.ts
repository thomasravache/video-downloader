import { createCandidateStore } from './candidates';
import type { CandidateStore } from './candidates';
import type {
  DetectResponse,
  DiagnosticsResponse,
  DownloadResponse,
  Provider,
  VideoCandidate,
} from './contracts';
import { redactUrls } from './diagnostics';
import type { Diagnostics } from './diagnostics';
import { toFilename } from './filename';
import { validateMessage } from './messages';
import type { DownloadPort, ScriptingPort, TabsPort } from './ports';

export type ServiceResponse = DetectResponse | DownloadResponse | DiagnosticsResponse;

export interface ServiceDeps {
  extensionId: string;
  /** Ordem do registro: providers específicos antes de `generic`. */
  providers: readonly Provider[];
  scripting: ScriptingPort;
  downloads: DownloadPort;
  tabs: TabsPort;
  diagnostics: Diagnostics;
  store?: CandidateStore;
}

export interface Service {
  handle(message: unknown, sender: { id?: string }): Promise<ServiceResponse>;
  /** `tabs.onRemoved`: descarta o estado da aba. */
  onTabRemoved(tabId: number): void;
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

    const found = new Map<string, VideoCandidate>();
    let failures = 0;
    for (const provider of matching) {
      try {
        const candidates = await provider.detect({ tabId, pageUrl, scripting: deps.scripting });
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

    const candidates = [...found.values()];
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
      })),
    });
    return { ok: true, candidates };
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
    onTabRemoved(tabId) {
      for (const candidate of store.forTab(tabId)) {
        correlations.delete(candidate.id);
      }
      store.removeTab(tabId);
    },
  };
}
