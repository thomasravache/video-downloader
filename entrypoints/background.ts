export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'ping'
    ) {
      sendResponse({ type: 'pong', version: browser.runtime.getManifest().version });
    }
    return false;
  });
});
