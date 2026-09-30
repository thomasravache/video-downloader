export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'ping'
    ) {
      sendResponse({ type: 'pong', version: browser.runtime.getManifest().version });
      // A resposta é síncrona; `return true` existe apenas para o fake runtime do WXT aguardar
      // o sendResponse (no Chromium real é irrelevante). SPEC-0005 deve revisar isto.
      return true;
    }
    return false;
  });
});
