import { providers } from 'virtual:providers';
import { createDiagnostics } from '../../src/core/diagnostics';
import { NetworkStore } from '../../src/core/network';
import { createService } from '../../src/core/service';
import type { FrameSnapshot, PageSnapshot } from '../../src/core/contracts';
import { collectVideos } from './collect-videos';
import { toNetworkResponse } from './network';

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
  });
  const service = createService({
    extensionId: browser.runtime.id,
    providers,
    diagnostics,
    network,
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
    },
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

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
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
