/**
 * Detecção por rede (SPEC-0010:E2E-01..E2E-03) nos dois flavors (projetos public/local).
 *
 * Fixtures: e2e/fixtures/pages/mse-network.html (<video> com src blob: de MediaSource + fetch de
 * /media/stream.mp4, 214 KiB, acima do corte de 100 KiB), pages/hls-network.html (fetch de
 * /hls/playlist.m3u8) e pages/no-video.html. Todas em 127.0.0.1, a origem que a cópia de teste do
 * build `public` já tem em host_permissions; o `webRequest` só enxerga origens com permissão.
 *
 * Contrato assumido:
 *  - a página marca `document.body.dataset.fetched = 'done'` quando o fetch termina;
 *  - popup.html?tabId=<n>: `candidate-item`, `download-button`, `badge-unsupported`, `empty-state`;
 *    o item de rede MP4 tem o selo "MP4" e botão Baixar; o item HLS tem o selo "HLS" e
 *    `badge-unsupported`, sem `download-button`; o item `blob:` do DOM continua listado como
 *    não suportado (SPEC-0005), por isso os itens baixáveis são contados pelo `download-button`;
 *  - o servidor de fixtures deve responder `.m3u8` com application/vnd.apple.mpegurl e `.mpd` com
 *    application/dash+xml (e2e/support/fixture-server.ts: acrescentar ao mapa MIME).
 */
import AxeBuilder from '@axe-core/playwright';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from '../support/extension';
import { openPopupForTab, tabIdOf } from './support';

const STREAM_SIZE = statSync(resolve(import.meta.dirname, '../fixtures/media/stream.mp4')).size;

/** Quantidade de .mp4 completos (tamanho do stream.mp4) salvos na pasta de downloads. */
function savedStreams(downloadsDir: string): number {
  return readdirSync(downloadsDir).filter(
    (name) => name.endsWith('.mp4') && statSync(join(downloadsDir, name)).size === STREAM_SIZE,
  ).length;
}

/**
 * Espera o observador de rede da extensão estar ativo. Logo após o Chromium carregar a extensão, os
 * listeners de `webRequest` do service worker ainda não valem para as primeiras requisições (a
 * captura da primeira página some, a seguinte é gravada). A sonda busca uma mídia de fixture numa
 * aba descartável até a captura aparecer em `storage.session`; só então a jornada começa.
 */
async function waitForNetworkObserver(
  context: BrowserContext,
  serviceWorker: Worker,
  fixturesUrl: string,
): Promise<void> {
  const probe = await context.newPage();
  await probe.goto(`${fixturesUrl}pages/no-video.html`);
  const probeTabId = await tabIdOf(probe, serviceWorker);
  await expect
    .poll(
      async () => {
        await probe.evaluate(async () => {
          await (await fetch(`/media/stream.mp4?probe=${String(Date.now())}`)).arrayBuffer();
        });
        return (await storedCaptureUrls(serviceWorker, probeTabId)).length;
      },
      {
        timeout: 15_000,
        intervals: [250, 500, 1_000],
        message: 'observador de rede (webRequest) da extensão ativo',
      },
    )
    .toBeGreaterThan(0);
  await probe.close();
}

/** Abre a página, espera o fetch dela terminar e devolve a página e o id da aba. */
async function openFetchingPage(
  context: BrowserContext,
  serviceWorker: Worker,
  fixturesUrl: string,
  path: string,
): Promise<{ page: Page; tabId: number }> {
  await waitForNetworkObserver(context, serviceWorker, fixturesUrl);
  const page = await context.newPage();
  await page.goto(`${fixturesUrl}${path}`);
  await expect(page.locator('body')).toHaveAttribute('data-fetched', 'done');
  return { page, tabId: await tabIdOf(page, serviceWorker) };
}

interface StoredCapture {
  candidate: { mediaUrl: string };
}

/** URLs de mídia gravadas em `storage.session` (`vd:net:<tabId>`) pela detecção por rede. */
async function storedCaptureUrls(serviceWorker: Worker, tabId: number): Promise<string[]> {
  const stored = await serviceWorker.evaluate(
    async (key) => {
      const chromeApi = (
        globalThis as unknown as {
          chrome: { storage: { session: { get(k: string): Promise<Record<string, unknown>> } } };
        }
      ).chrome;
      return (await chromeApi.storage.session.get(key))[key];
    },
    `vd:net:${String(tabId)}`,
  );
  return Array.isArray(stored) ? (stored as StoredCapture[]).map((e) => e.candidate.mediaUrl) : [];
}

/**
 * Espera, de forma determinística, a captura de rede estar gravada: o popup roda a detecção uma
 * única vez ao abrir, então abri-lo antes da gravação daria uma lista sem o item de rede.
 */
async function waitForStoredCapture(
  serviceWorker: Worker,
  tabId: number,
  urlSuffix: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await storedCaptureUrls(serviceWorker, tabId)).filter((url) => url.endsWith(urlSuffix))
          .length,
      {
        timeout: 15_000,
        message: `captura de rede *${urlSuffix} gravada para a aba ${String(tabId)}`,
      },
    )
    .toBe(1);
}

/** Espera a captura de rede da aba ser limpa (navegação para outra página). */
async function waitForClearedCapture(serviceWorker: Worker, tabId: number): Promise<void> {
  await expect
    .poll(async () => (await storedCaptureUrls(serviceWorker, tabId)).length, {
      timeout: 15_000,
      message: `captura de rede da aba ${String(tabId)} limpa após a navegação`,
    })
    .toBe(0);
}

async function seriousViolations(popup: Page) {
  const { violations } = await new AxeBuilder({ page: popup }).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('detecção por rede', () => {
  test('SPEC-0010:E2E-01 [jornada: baixar-video-direto] vídeo blob:/MSE com MP4 buscado por fetch: o popup lista o MP4 de rede e o download salva o arquivo', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/mse-network.html',
    );

    await waitForStoredCapture(serviceWorker, tabId, '/media/stream.mp4');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const downloadable = popup
      .getByTestId('candidate-item')
      .filter({ has: popup.getByTestId('download-button') });
    await expect(downloadable).toHaveCount(1);
    await expect(downloadable).toContainText('MP4');
    expect(await seriousViolations(popup)).toEqual([]);

    await downloadable.getByTestId('download-button').click();

    await expect.poll(() => savedStreams(downloadsDir), { timeout: 20_000 }).toBe(1);
  });

  test('SPEC-0010:E2E-02 playlist .m3u8 buscada pela página: o popup a lista com o selo HLS e badge-unsupported, sem botão de download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-network.html',
    );

    await waitForStoredCapture(serviceWorker, tabId, '/hls/playlist.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('HLS');
    await expect(item.getByTestId('badge-unsupported')).toBeVisible();
    await expect(item.getByTestId('download-button')).toHaveCount(0);
    await expect(popup.getByTestId('download-button')).toHaveCount(0);
  });

  test('SPEC-0010:E2E-03 depois de navegar a aba para outra página a lista não contém mais os itens da anterior', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { page, tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/mse-network.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/media/stream.mp4');
    const popup = await openPopupForTab(context, extensionId, tabId);
    await expect(popup.getByTestId('download-button')).toHaveCount(1);

    await page.goto(`${fixturesUrl}pages/no-video.html`);
    await waitForClearedCapture(serviceWorker, tabId);
    await popup.reload();

    await expect(popup.getByTestId('empty-state')).toBeVisible();
    await expect(popup.getByTestId('candidate-item')).toHaveCount(0);
    await expect(popup.getByTestId('download-button')).toHaveCount(0);
  });
});
