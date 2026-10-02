/**
 * Playlists HLS no popup (SPEC-0011:E2E-01..E2E-03) nos dois flavors (projetos public/local).
 *
 * Fixtures (e2e/fixtures/hls/ e pages/): hls-master.html busca `/hls/master.m3u8?token=abc123` (master
 * de 3 qualidades, 1080p/720p/480p, com playlists de variante v1080/v720/v480.m3u8), hls-encrypted.html
 * busca `/hls/encrypted.m3u8` (EXT-X-KEY AES-128) e hls-live.html busca `/hls/live.m3u8` (sem ENDLIST).
 * A URL do master TEM query string de propósito: a captura de rede precisa tratar `.m3u8` com query.
 *
 * Contrato assumido (spec §6):
 *  - o popup resolve cada candidato HLS pela mensagem `resolveHls` e mostra, no cartão (`candidate-item`
 *    com o selo "HLS"): `hls-loading` enquanto lê; `quality-select` (um <select> com rótulo, uma <option>
 *    por variante, da maior para a menor, selecionada a maior); `badge-encrypted`; `badge-live`;
 *    `hls-error`; `download-button` só para HLS limpo e VOD (SPEC-0012: antes, nenhum para HLS);
 *  - o texto das opções contém o rótulo da variante ('1080p', '720p', '480p');
 *  - o service worker requisita apenas as playlists (master + melhor variante): nenhum segmento, chave
 *    nem outra variante.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/extension';
import { openFetchingPage, waitForStoredCapture } from './hls-support';
import { openPopupForTab } from './support';

async function seriousViolations(popup: Page) {
  const { violations } = await new AxeBuilder({ page: popup }).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('playlists HLS', () => {
  test('SPEC-0011:E2E-01 master HLS de 3 qualidades (URL com query): o cartão HLS mostra quality-select na maior qualidade com as três opções', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const workerRequests: string[] = [];
    context.on('request', (request) => {
      if (request.serviceWorker()) {
        workerRequests.push(request.url());
      }
    });
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-master.html',
    );

    await waitForStoredCapture(serviceWorker, tabId, '/hls/master.m3u8?token=abc123');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('HLS');
    const select = item.getByTestId('quality-select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveText([/1080p/, /720p/, /480p/]);
    await expect(select.locator('option:checked')).toHaveText(/1080p/);
    await expect(item.getByTestId('hls-loading')).toHaveCount(0);
    await expect(item.getByTestId('hls-error')).toHaveCount(0);
    await expect(item.getByTestId('badge-encrypted')).toHaveCount(0);
    await expect(item.getByTestId('badge-live')).toHaveCount(0);
    // SPEC-0012: HLS limpo e VOD já resolvido tem o botão Baixar (antes da SPEC-0012 não havia).
    await expect(item.getByTestId('download-button')).toBeEnabled();
    expect(await seriousViolations(popup)).toEqual([]);

    // A extensão só requisitou as playlists: o master observado (com a query) e a melhor variante.
    expect([...workerRequests].sort()).toEqual(
      [`${fixturesUrl}hls/master.m3u8?token=abc123`, `${fixturesUrl}hls/v1080.m3u8`].sort(),
    );
  });

  test('SPEC-0011:E2E-02 playlist com EXT-X-KEY AES-128: o popup mostra badge-encrypted e nenhum botão de download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const workerRequests: string[] = [];
    context.on('request', (request) => {
      if (request.serviceWorker()) {
        workerRequests.push(request.url());
      }
    });
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-encrypted.html',
    );

    await waitForStoredCapture(serviceWorker, tabId, '/hls/encrypted.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('HLS');
    await expect(item.getByTestId('badge-encrypted')).toBeVisible();
    await expect(item.getByTestId('badge-live')).toHaveCount(0);
    await expect(popup.getByTestId('download-button')).toHaveCount(0);
    // Nem a chave (key.bin) nem os segmentos são requisitados.
    expect(workerRequests).toEqual([`${fixturesUrl}hls/encrypted.m3u8`]);
  });

  test('SPEC-0011:E2E-03 playlist sem ENDLIST: o popup mostra badge-live e nenhum botão de download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-live.html',
    );

    await waitForStoredCapture(serviceWorker, tabId, '/hls/live.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('HLS');
    await expect(item.getByTestId('badge-live')).toBeVisible();
    await expect(item.getByTestId('badge-encrypted')).toHaveCount(0);
    await expect(popup.getByTestId('download-button')).toHaveCount(0);
  });
});
