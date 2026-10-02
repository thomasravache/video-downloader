import { providers } from 'virtual:providers';
import { createDiagnostics } from '../../src/core/diagnostics';
import { createService } from '../../src/core/service';
import type { PageSnapshot } from '../../src/core/contracts';
import { collectVideos } from './collect-videos';

function isPageSnapshot(value: unknown): value is PageSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { videos?: unknown }).videos)
  );
}

/**
 * Background (service worker efêmero): liga o `src/core` às APIs do navegador. Estado só em
 * memória; o popup reconstrói tudo com uma nova detecção ao abrir (ADR-0006).
 */
export default defineBackground(() => {
  const service = createService({
    extensionId: browser.runtime.id,
    providers,
    diagnostics: createDiagnostics(),
    scripting: {
      async collectVideos(tabId) {
        const [injection] = await browser.scripting.executeScript({
          target: { tabId },
          func: collectVideos,
        });
        if (!isPageSnapshot(injection?.result)) {
          throw new Error('executeScript não devolveu o retrato da página');
        }
        return injection.result;
      },
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

  browser.tabs.onRemoved.addListener((tabId) => {
    service.onTabRemoved(tabId);
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
