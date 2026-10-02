/**
 * Ajudantes das jornadas HLS (SPEC-0011). Não é teste.
 *
 * Reproduzem, sem sleeps, a sincronização de network-sniffing.spec.ts (SPEC-0010): logo após o
 * Chromium carregar a extensão, os listeners de `webRequest` do service worker ainda não valem para
 * as primeiras requisições; `waitForNetworkObserver` usa uma sonda numa aba descartável até a captura
 * aparecer em `storage.session`, e `waitForStoredCapture` espera a captura da página ser gravada
 * (`vd:net:<tabId>`) antes de o popup rodar a detecção.
 */
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect } from '../support/extension';
import { tabIdOf } from './support';

interface StoredCapture {
  candidate: { mediaUrl: string };
}

/** URLs de mídia gravadas em `storage.session` (`vd:net:<tabId>`) pela detecção por rede. */
export async function storedCaptureUrls(serviceWorker: Worker, tabId: number): Promise<string[]> {
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

/** Espera o observador de rede da extensão estar ativo (sonda com mídia de fixture numa aba descartável). */
export async function waitForNetworkObserver(
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
export async function openFetchingPage(
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

/** Espera, de forma determinística, a captura de rede terminada em `urlSuffix` (incluindo a query) estar gravada. */
export async function waitForStoredCapture(
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
