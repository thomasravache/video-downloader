/**
 * Jornada baixar-video-direto (SPEC-0005:E2E-01, IT-06) nos dois flavors (projetos public/local).
 *
 * Contrato assumido:
 *  - a extensão sob teste é a cópia do build com host_permissions para http://127.0.0.1/* (harness);
 *  - popup.html?tabId=<n>: data-testid `candidate-list`, `candidate-item`, `download-button`;
 *  - candidato: título = <title> da página ("Aula de teste"), badge do formato ("MP4");
 *  - o arquivo baixado vai para a pasta `downloadsDir` com o nome "<título>.mp4". Com o
 *    `downloadsPath` atual o Playwright renomeia downloads para GUID; o harness (Implementer) deve
 *    gravar `download.default_directory`/`savefile.default_directory` = downloadsDir no
 *    `Default/Preferences` do perfil e enviar, por uma sessão CDP, `Browser.setDownloadBehavior`
 *    com `behavior: 'default'` (verificado em probe: o Chromium respeita o `filename` pedido).
 *  - SPEC-0024:E2E-02: com a re-detecção ativa (popup aberto consultando `network-revision`; botão
 *    `redetect-button` refaz o `detect`), a jornada continua igual: um cartão, título, badge e download.
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/extension';
import { detectStarts, openPageAndPopup } from './support';

const SAMPLE_SIZE = statSync(resolve(import.meta.dirname, '../fixtures/sample.mp4')).size;

async function seriousViolations(popup: Page) {
  const { violations } = await new AxeBuilder({ page: popup }).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('baixar vídeo direto', () => {
  test('SPEC-0005:E2E-01 lista o vídeo com título e badge MP4 e o clique em Baixar salva o arquivo com o nome esperado', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/video.html`,
    );

    const item = popup.getByTestId('candidate-item');
    await expect(popup.getByTestId('candidate-list')).toBeVisible();
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Aula de teste');
    await expect(item).toContainText('MP4');

    await item.getByTestId('download-button').click();

    const expected = join(downloadsDir, 'Aula de teste.mp4');
    await expect
      .poll(() => (existsSync(expected) ? statSync(expected).size : -1), { timeout: 20_000 })
      .toBe(SAMPLE_SIZE);
  });

  test('SPEC-0005:E2E-01 popup acessível: axe sem violações serious/critical e Baixar alcançável só pelo teclado', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/video.html`,
    );
    await expect(popup.getByTestId('candidate-item')).toHaveCount(1);

    expect(await seriousViolations(popup)).toEqual([]);

    const button = popup.getByTestId('download-button');
    await expect(button).toHaveAccessibleName(/\S/);
    for (let i = 0; i < 10; i++) {
      if (await button.evaluate((el) => el === document.activeElement)) {
        break;
      }
      await popup.keyboard.press('Tab');
    }
    await expect(button).toBeFocused();
    await popup.keyboard.press('Enter');

    const expected = join(downloadsDir, 'Aula de teste.mp4');
    await expect
      .poll(() => (existsSync(expected) ? statSync(expected).size : -1), { timeout: 20_000 })
      .toBe(SAMPLE_SIZE);
  });

  test('SPEC-0005:E2E-01 página com dois <source> lista um candidato por URL distinta', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/two-sources.html`,
    );

    await expect(popup.getByTestId('candidate-item')).toHaveCount(2);
  });

  test('SPEC-0005:E2E-01 desempenho: a lista de 20 vídeos renderiza em menos de 500 ms após abrir o popup', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/twenty-videos.html`,
    );

    await expect(popup.getByTestId('candidate-item')).toHaveCount(20);
    // performance.now() do popup conta desde o início da navegação dele.
    const elapsed = await popup.evaluate(() => performance.now());
    expect(elapsed).toBeLessThan(500);
  });

  test('SPEC-0005:IT-06 durante o fluxo completo o service worker só requisita o download do fixture', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const workerRequests: string[] = [];
    const popupRequests: string[] = [];
    const popupPages = new Set<Page>();
    context.on('request', (request) => {
      if (request.serviceWorker()) {
        workerRequests.push(request.url());
        return;
      }
      try {
        if (popupPages.has(request.frame().page())) {
          popupRequests.push(request.url());
        }
      } catch {
        // requisição sem frame (ex.: download do navegador): não é do popup nem da página
      }
    });

    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/video.html`,
    );
    popupPages.add(popup);
    await popup.reload();
    await expect(popup.getByTestId('candidate-item')).toHaveCount(1);
    await popup.getByTestId('download-button').click();
    const expected = join(downloadsDir, 'Aula de teste.mp4');
    await expect
      .poll(() => (existsSync(expected) ? statSync(expected).size : -1), { timeout: 20_000 })
      .toBe(SAMPLE_SIZE);

    expect(workerRequests.filter((url) => url !== `${fixturesUrl}sample.mp4`)).toEqual([]);
    expect(
      popupRequests.filter((url) => !url.startsWith(`chrome-extension://${extensionId}/`)),
    ).toEqual([]);
  });

  test('SPEC-0024:E2E-02 [jornada: baixar-video-direto] com a re-detecção ativa o cartão continua único e o clique em Baixar salva o arquivo com o nome esperado', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/video.html`,
    );
    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);

    // Re-detecção com o popup aberto (botão "Procurar de novo"): a lista é redesenhada sem duplicar o cartão.
    const before = await detectStarts(popup);
    await popup.getByTestId('redetect-button').click();
    await expect.poll(() => detectStarts(popup), { timeout: 2_000 }).toBeGreaterThan(before);
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Aula de teste');
    await expect(item).toContainText('MP4');

    await item.getByTestId('download-button').click();

    const expected = join(downloadsDir, 'Aula de teste.mp4');
    await expect
      .poll(() => (existsSync(expected) ? statSync(expected).size : -1), { timeout: 20_000 })
      .toBe(SAMPLE_SIZE);
  });
});
