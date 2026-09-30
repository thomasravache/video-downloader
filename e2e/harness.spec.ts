import { expect, test } from './support/extension';

test.describe('harness E2E com a extensão carregada', () => {
  test('SPEC-0003:IT-02 requisição a host externo é abortada e fixturesUrl carrega', async ({
    context,
    fixturesUrl,
  }) => {
    const page = await context.newPage();

    await expect(page.goto('https://example.com')).rejects.toThrow(/ERR_FAILED|ERR_BLOCKED|net::/);

    const response = await page.goto(fixturesUrl);
    expect(response?.ok()).toBe(true);
    expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  });

  test('SPEC-0003:IT-03 extensão public: o service worker responde ao ping enviado pelo popup e o popup renderiza o título i18n', async ({
    flavor,
    extensionId,
    serviceWorker,
    openPopup,
  }) => {
    expect(flavor).toBe('public');
    expect(serviceWorker.url()).toMatch(new RegExp(`^chrome-extension://${extensionId}/`));

    const popup = await openPopup();
    const pong: unknown = await popup.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'ping' }, resolve);
        }),
    );
    expect(pong).toMatchObject({ type: 'pong', version: expect.any(String) });

    await expect(popup.locator('#title')).toHaveText('Video Downloader');
  });
});
