export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'ping'
    ) {
      sendResponse({ type: 'pong', version: browser.runtime.getManifest().version });
      // `true` sinaliza resposta assíncrona/ativa: o fake de browser.* só aguarda sendResponse assim.
      return true;
    }
    return false;
  });
});
