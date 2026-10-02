import { providers } from 'virtual:providers';
import { createDiagnostics } from '../../src/core/diagnostics';
import { createService } from '../../src/core/service';
import type { FrameSnapshot, PageSnapshot } from '../../src/core/contracts';
import { collectVideos } from './collect-videos';

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
  const service = createService({
    extensionId: browser.runtime.id,
    providers,
    diagnostics: createDiagnostics(),
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
