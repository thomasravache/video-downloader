/**
 * Jornada baixar-video-em-iframe (SPEC-0009:E2E-01..E2E-03).
 *
 * Fixtures: e2e/fixtures/pages/iframe-parent.html (página em 127.0.0.1 que embute, por script, um
 * <iframe> para `http://localhost:<mesma porta>/pages/iframe-player.html`, com um <video> MP4) e
 * iframes-many.html (frame principal + 4 iframes de localhost, 20 vídeos distintos).
 *
 * Contrato assumido do harness (e2e/support, a construir pelo Implementer):
 *  - `localhost` (porta do servidor de fixtures) é alcançável pelo navegador de teste, como
 *    127.0.0.1: o isolamento de rede libera `localhost` além de 127.0.0.1;
 *  - build `local`: a extensão carregada tem o manifest ENTREGUE (host_permissions http(s)) — sem
 *    sobrescrever host_permissions;
 *  - build `public`: a cópia de teste tem host_permissions SÓ para http://127.0.0.1/* (+ os padrões
 *    da opção `grantedHostPatterns`, que simula a concessão de acesso por site: E2E-03);
 *  - popup: data-testid `access-needed`, `access-origin`, `grant-access`, `access-denied`,
 *    `candidate-item`, `download-button`; o texto de `access-origin` é a origem 'http://localhost:<porta>'.
 *
 * O diálogo nativo de permissões não é automatizável: a concessão real é verificada à mão no G6.
 */
import AxeBuilder from '@axe-core/playwright';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from '../support/extension';
import { expectPortugueseText, openPopupForTab, tabIdOf } from './support';

const SAMPLE_SIZE = statSync(resolve(import.meta.dirname, '../fixtures/sample.mp4')).size;

function iframeOrigin(fixturesUrl: string): string {
  return `http://localhost:${new URL(fixturesUrl).port}`;
}

/** Quantidade de arquivos .mp4 completos (tamanho do sample) salvos na pasta de downloads. */
function savedSamples(downloadsDir: string): number {
  return readdirSync(downloadsDir).filter(
    (name) => name.endsWith('.mp4') && statSync(join(downloadsDir, name)).size === SAMPLE_SIZE,
  ).length;
}

/** Abre a página, espera o(s) iframe(s) carregarem o(s) vídeo(s) e abre o popup da aba. */
async function openFramedPageAndPopup(
  context: BrowserContext,
  serviceWorker: Worker,
  extensionId: string,
  url: string,
  expectedFrames: number,
  videosPerChildFrame: number,
): Promise<{ page: Page; popup: Page }> {
  const page = await context.newPage();
  await page.goto(url);
  await expect.poll(() => page.frames().length).toBe(expectedFrames);
  for (const child of page.frames().filter((f) => f !== page.mainFrame())) {
    await child.waitForFunction(
      (count) => document.querySelectorAll('video').length === count,
      videosPerChildFrame,
    );
  }
  const tabId = await tabIdOf(page, serviceWorker);
  const popup = await openPopupForTab(context, extensionId, tabId);
  return { page, popup };
}

async function seriousViolations(popup: Page) {
  const { violations } = await new AxeBuilder({ page: popup }).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('baixar vídeo em iframe de outra origem (build local)', () => {
  test.skip(
    ({ flavor }) => flavor !== 'local',
    'E2E-01 roda no build local (host_permissions amplo, ADR-0012)',
  );

  test('SPEC-0009:E2E-01 [jornada: baixar-video-em-iframe] lista o vídeo do iframe de localhost sem pedir acesso e o download salva o arquivo', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const { popup } = await openFramedPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/iframe-parent.html`,
      2,
      1,
    );

    const item = popup.getByTestId('candidate-item');
    await expect(popup.getByTestId('candidate-list')).toBeVisible();
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('MP4');
    await expect(popup.getByTestId('access-needed')).toHaveCount(0);

    await item.getByTestId('download-button').click();

    await expect.poll(() => savedSamples(downloadsDir), { timeout: 20_000 }).toBe(1);
  });

  test('SPEC-0009:E2E-01 [jornada: baixar-video-em-iframe] desempenho: 5 frames e 20 vídeos renderizam em menos de 700 ms após abrir o popup', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { popup } = await openFramedPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/iframes-many.html`,
      5,
      4,
    );

    await expect(popup.getByTestId('candidate-item')).toHaveCount(20);
    // performance.now() do popup conta desde o início da navegação dele.
    const elapsed = await popup.evaluate(() => performance.now());
    expect(elapsed).toBeLessThan(700);
  });
});

test.describe('iframe de outra origem sem acesso (build public)', () => {
  test.skip(
    ({ flavor }) => flavor !== 'public',
    'E2E-02 roda no build public (cópia só com 127.0.0.1)',
  );

  test('SPEC-0009:E2E-02 mostra o bloco "acesso necessário" com a origem do iframe e nenhum candidato dele', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { popup } = await openFramedPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/iframe-parent.html`,
      2,
      1,
    );

    await expect(popup.getByTestId('access-needed')).toBeVisible();
    await expect(popup.getByTestId('access-origin')).toHaveCount(1);
    await expect(popup.getByTestId('access-origin')).toContainText(iframeOrigin(fixturesUrl));
    await expect(popup.getByTestId('grant-access')).toBeVisible();
    await expect(popup.getByTestId('candidate-item')).toHaveCount(0);
    await expect(popup.getByTestId('access-denied')).toHaveCount(0);
    await expectPortugueseText(
      popup.getByTestId('access-needed'),
      'Esta página tem players em outros sites:',
      serviceWorker,
    );
    await expectPortugueseText(popup.getByTestId('grant-access'), 'Permitir acesso', serviceWorker);
  });

  test('SPEC-0009:E2E-02 acessível: axe sem violações serious/critical e "Permitir acesso" com nome acessível e alcançável pelo teclado', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { popup } = await openFramedPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/iframe-parent.html`,
      2,
      1,
    );
    await expect(popup.getByTestId('access-needed')).toBeVisible();

    expect(await seriousViolations(popup)).toEqual([]);

    const button = popup.getByTestId('grant-access');
    await expect(button).toHaveAccessibleName(/\S/);
    for (let i = 0; i < 10; i++) {
      if (await button.evaluate((el) => el === document.activeElement)) {
        break;
      }
      await popup.keyboard.press('Tab');
    }
    await expect(button).toBeFocused();
  });
});

test.describe('iframe de outra origem com acesso concedido (build public)', () => {
  test.skip(
    ({ flavor }) => flavor !== 'public',
    'E2E-03 roda no build public (concessão simulada na cópia de teste)',
  );
  test.use({ grantedHostPatterns: ['http://localhost/*'] });

  test('SPEC-0009:E2E-03 com a origem do iframe liberada na cópia de teste o vídeo aparece sem pedir acesso e baixa', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const { popup } = await openFramedPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/iframe-parent.html`,
      2,
      1,
    );

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(popup.getByTestId('access-needed')).toHaveCount(0);

    await item.getByTestId('download-button').click();

    await expect.poll(() => savedSamples(downloadsDir), { timeout: 20_000 }).toBe(1);
  });
});
