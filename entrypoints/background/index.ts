import { providers } from 'virtual:providers';
import { createDiagnostics } from '../../src/core/diagnostics';
import { NetworkStore } from '../../src/core/network';
import { createService } from '../../src/core/service';
import type { FrameSnapshot, PageSnapshot } from '../../src/core/contracts';
import { collectVideos } from './collect-videos';
import { toNetworkResponse } from './network';
import { createOffscreenPort } from './offscreen';
import { createPlaylistFetcher } from './playlist-fetcher';
import { createRequestContextManager } from './request-context';
import type { DnrPort } from './request-context';

function isPageSnapshot(value: unknown): value is PageSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { pageUrl, videos, crossOriginFrames } = value as Record<string, unknown>;
  return (
    typeof pageUrl === 'string' &&
    Array.isArray(videos) &&
    Array.isArray(crossOriginFrames) &&
    (crossOriginFrames as unknown[]).every((o) => typeof o === 'string')
  );
}

/**
 * Background (service worker efêmero): liga o `src/core` às APIs do navegador. Estado só em
 * memória; o popup reconstrói tudo com uma nova detecção ao abrir (ADR-0006).
 */
export default defineBackground(() => {
  // `storage.session` vive só na memória do navegador e sobrevive à suspensão do service worker.
  const diagnostics = createDiagnostics();
  const network = new NetworkStore({
    get: async (key) => (await browser.storage.session.get(key))[key],
    set: (key, value) => browser.storage.session.set({ [key]: value }),
    remove: (key) => browser.storage.session.remove(key),
    keys: async () => Object.keys(await browser.storage.session.get(null)),
  });
  // Contexto de requisição da página (SPEC-0016): só o flavor local tem a permissão
  // `declarativeNetRequestWithHostAccess`; sem a API (public) não há repetição com contexto.
  const dnr = (browser as { declarativeNetRequest?: DnrPort }).declarativeNetRequest;
  const requestContext =
    dnr === undefined
      ? undefined
      : createRequestContextManager({
          dnr: {
            updateSessionRules: (options) => dnr.updateSessionRules(options),
            getSessionRules: () => dnr.getSessionRules(),
          },
          extensionId: browser.runtime.id,
        });
  // Regras órfãs de um service worker anterior saem na partida (melhor esforço).
  void requestContext?.removeOrphans().catch((error: unknown) => {
    diagnostics.log('warn', 'context.cleanup_failed', diagnostics.newCorrelationId(), {
      reason: error instanceof Error ? error.name : 'unknown',
    });
  });
  const service = createService({
    extensionId: browser.runtime.id,
    providers,
    diagnostics,
    network,
    playlists: createPlaylistFetcher(),
    scripting: {
      async collectVideos(tabId) {
        const injections = await browser.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: collectVideos,
        });
        // Frame sem acesso ou que recarregou durante a injeção vem sem `result`: é ignorado.
        const frames: FrameSnapshot[] = [];
        for (const injection of injections) {
          if (isPageSnapshot(injection.result)) {
            frames.push({ frameId: injection.frameId, snapshot: injection.result });
          }
        }
        if (frames.length === 0) {
          throw new Error('nenhum frame permitiu a coleta de vídeos');
        }
        return frames;
      },
    },
    permissions: {
      contains: (origins) => browser.permissions.contains({ origins }),
      request: (origins) => browser.permissions.request({ origins }),
    },
    downloads: {
      download: (options) => browser.downloads.download(options),
      cancel: (downloadId) => browser.downloads.cancel(downloadId),
    },
    jobStore: {
      get: async (key) => (await browser.storage.session.get(key))[key],
      set: (key, value) => browser.storage.session.set({ [key]: value }),
    },
    offscreen: createOffscreenPort(),
    ...(requestContext !== undefined && { requestContext }),
    tabs: {
      async getUrl(tabId) {
        return (await browser.tabs.get(tabId)).url;
      },
    },
  });

  // Observação apenas (nunca bloqueante, nunca lê corpo). Registrados de forma síncrona, no topo
  // do service worker, para que os eventos o acordem (ADR-0012, SPEC-0010).
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  const unavailable = (reason: string): void => {
    diagnostics.log('warn', 'network.unavailable', diagnostics.newCorrelationId(), { reason });
  };
  // Sem `webRequest` a detecção continua só pelo DOM. Cada registro tem o próprio try/catch e o
  // diagnóstico guarda só o nome do erro (a mensagem pode conter URLs/tokens).
  const webRequest = (browser as { webRequest?: typeof browser.webRequest }).webRequest;
  if (webRequest === undefined) {
    unavailable('no_api');
  } else {
    try {
      webRequest.onResponseStarted.addListener(
        (details) => {
          void service.onNetworkResponse(toNetworkResponse(details));
        },
        filter,
        ['responseHeaders'],
      );
    } catch (error) {
      unavailable(error instanceof Error ? error.name : 'unknown');
    }
    try {
      webRequest.onBeforeRequest.addListener(
        (details) => {
          // Requisições sem aba (tabId < 0) não têm lista de rede a limpar.
          if (details.tabId >= 0) {
            void service.clearNetwork(details.tabId);
          }
        },
        { ...filter, types: ['main_frame'] },
      );
    } catch (error) {
      unavailable(error instanceof Error ? error.name : 'unknown');
    }
  }

  browser.tabs.onRemoved.addListener((tabId) => {
    service.onTabRemoved(tabId);
    void service.clearNetwork(tabId);
  });

  // Download concluído/interrompido: fecha o job em `saving` (SPEC-0012). Registro síncrono, no topo.
  // Só API ausente/não implementada (ex.: fake de browser.* do WXT) é tolerada; outra falha propaga.
  const downloadsChanged = (
    browser as { downloads?: { onChanged?: typeof browser.downloads.onChanged } }
  ).downloads?.onChanged;
  const downloadsUnavailable = (reason: string): void => {
    diagnostics.log('warn', 'downloads.unavailable', diagnostics.newCorrelationId(), { reason });
  };
  if (downloadsChanged === undefined) {
    downloadsUnavailable('no_api');
  } else {
    try {
      downloadsChanged.addListener((delta) => {
        void service.onDownloadChanged(delta);
      });
    } catch (error) {
      if (!(error instanceof Error) || !/not implemented/i.test(error.message)) {
        throw error;
      }
      downloadsUnavailable('not_implemented');
    }
  }

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const target =
      typeof message === 'object' && message !== null
        ? (message as { target?: unknown }).target
        : undefined;
    if (target === 'offscreen') {
      // Comando ao documento offscreen: quem responde é ele.
      return false;
    }
    if (target === 'background') {
      // Evento do offscreen (SPEC-0012): responde só depois de processar.
      void service.onOffscreenMessage(message, sender).then((ok) => {
        sendResponse({ ok });
      });
      return true;
    }
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'ping'
    ) {
      sendResponse({ type: 'pong', version: browser.runtime.getManifest().version });
      // Resposta síncrona; `return true` mantém o fake runtime do WXT aguardando o sendResponse.
      return true;
    }
    // No Chrome o listener só mantém o canal aberto com `return true` + sendResponse assíncrono.
    void service.handle(message, sender).then(sendResponse);
    return true;
  });
});
