/**
 * SPEC-0005:E2E-02 (DRM/EME Clear Key de teste e stream blob:) e E2E-03 (página sem vídeo).
 *
 * Contrato assumido: data-testid `candidate-item`, `badge-drm`, `badge-unsupported`,
 * `download-button` (ausente nesses casos) e `empty-state`; textos pt-BR "Protegido (DRM)",
 * "Ainda não suportado", "Nenhum vídeo encontrado nesta página".
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/extension';
import { expectPortugueseText, openPageAndPopup, openPopupForTab, tabIdOf } from './support';

interface FixtureFlags {
  __drmReady?: boolean;
  __drmError?: string;
  __streamReady?: boolean;
}

async function flags(page: Page): Promise<FixtureFlags> {
  return page.evaluate(() => {
    const w = window as unknown as FixtureFlags;
    return { __drmReady: w.__drmReady, __drmError: w.__drmError, __streamReady: w.__streamReady };
  });
}

test.describe('vídeo protegido, stream e página vazia', () => {
  test('SPEC-0005:E2E-02 vídeo com EME Clear Key mostra Protegido (DRM) sem botão de download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}pages/drm-clearkey.html`);
    await page.waitForFunction(() => {
      const w = window as unknown as FixtureFlags;
      return w.__drmReady === true || w.__drmError !== undefined;
    });
    expect((await flags(page)).__drmError).toBeUndefined();
    expect((await flags(page)).__drmReady).toBe(true);
    const popup = await openPopupForTab(context, extensionId, await tabIdOf(page, serviceWorker));

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('badge-drm')).toBeVisible();
    await expectPortugueseText(item.getByTestId('badge-drm'), 'Protegido (DRM)', serviceWorker);
    await expect(popup.getByTestId('download-button')).toHaveCount(0);

    const { violations } = await new AxeBuilder({ page: popup }).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });

  test('SPEC-0005:E2E-02 vídeo por stream blob: mostra Ainda não suportado sem botão de download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { page, popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/blob-stream.html`,
    );
    expect((await flags(page)).__streamReady).toBe(true);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('badge-unsupported')).toBeVisible();
    await expectPortugueseText(
      item.getByTestId('badge-unsupported'),
      'Ainda não suportado',
      serviceWorker,
    );
    await expect(popup.getByTestId('download-button')).toHaveCount(0);
  });

  test('SPEC-0005:E2E-03 página sem vídeo mostra o estado vazio', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/no-video.html`,
    );

    await expect(popup.getByTestId('empty-state')).toBeVisible();
    await expectPortugueseText(
      popup.getByTestId('empty-state'),
      'Nenhum vídeo encontrado nesta página',
      serviceWorker,
    );
    await expect(popup.getByTestId('candidate-item')).toHaveCount(0);
    await expect(popup.getByTestId('restricted-state')).toHaveCount(0);
  });
});
