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

  test('SPEC-0003:IT-03 extensão public: service worker responde ping e o popup renderiza o título i18n', async ({
    flavor,
    serviceWorker,
    openPopup,
  }) => {
    expect(flavor).toBe('public');

    const pong: unknown = await serviceWorker.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'ping' }, resolve);
        }),
    );
    expect(pong).toMatchObject({ type: 'pong', version: expect.any(String) });

    const popup = await openPopup();
    await expect(popup.locator('#title')).toHaveText('Video Downloader');
  });
});
