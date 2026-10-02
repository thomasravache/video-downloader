/**
 * Ajudantes das jornadas E2E de SPEC-0005 (não é teste; o Playwright só roda `*.spec.ts`).
 *
 * Usa apenas as fixtures de e2e/support/extension.ts. O harness (e2e/support/**) carrega a
 * extensão a partir de uma CÓPIA do build com `host_permissions: ["http://127.0.0.1/*"]`
 * acrescentada ao manifest (Emenda 1 (teste) da SPEC-0005), porque o Playwright não concede
 * `activeTab`. O popup é aberto como `popup.html?tabId=<n>`.
 */
import { expect, test } from '../support/extension';
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';

interface ChromeInWorker {
  i18n: { getUILanguage(): string };
  tabs: { query(q: Record<string, unknown>): Promise<{ id?: number }[]> };
  downloads: {
    search(
      q: Record<string, unknown>,
    ): Promise<{ filename: string; state: string; url: string; totalBytes: number }[]>;
  };
}

/** Id da aba (do `chrome.tabs`) em que `page` está — a aba em primeiro plano. */
export async function tabIdOf(page: Page, serviceWorker: Worker): Promise<number> {
  await page.bringToFront();
  const id = await serviceWorker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: ChromeInWorker }).chrome;
    const tabs = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0]?.id;
  });
  expect(id, 'aba ativa').toEqual(expect.any(Number));
  return id as number;
}

/** Abre o popup da extensão apontando para a aba `tabId` (popup.html?tabId=<n>). */
export async function openPopupForTab(
  context: BrowserContext,
  extensionId: string,
  tabId: number,
): Promise<Page> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${String(tabId)}`);
  return popup;
}

/** Abre `url` numa aba nova, espera carregar e devolve a página e o popup dela. */
export async function openPageAndPopup(
  context: BrowserContext,
  serviceWorker: Worker,
  extensionId: string,
  url: string,
): Promise<{ page: Page; popup: Page; tabId: number }> {
  const page = await context.newPage();
  await page.goto(url);
  const tabId = await tabIdOf(page, serviceWorker);
  const popup = await openPopupForTab(context, extensionId, tabId);
  return { page, popup, tabId };
}

/**
 * Os textos pt-BR do popup só são verificáveis quando o idioma da UI do Chromium é pt (no CI Linux,
 * `--lang=pt-BR` + LANGUAGE; no macOS o Chromium fica em en-US). Nos demais casos o teste afirma
 * pelos `data-testid` (sempre) e registra a anotação de que o texto não foi verificado.
 */
export async function expectPortugueseText(
  locator: Locator,
  text: string,
  serviceWorker: Worker,
): Promise<void> {
  const language = await serviceWorker.evaluate(() =>
    (globalThis as unknown as { chrome: ChromeInWorker }).chrome.i18n.getUILanguage(),
  );
  if (language.toLowerCase().startsWith('pt')) {
    await expect(locator).toContainText(text);
  } else {
    test.info().annotations.push({
      type: 'texto pt-BR não verificado',
      description: `UI do Chromium em ${language}: "${text}" não conferido`,
    });
  }
}

export type { ChromeInWorker };
