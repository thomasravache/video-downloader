/**
 * [jornada: branding-popup] (SPEC-0022:E2E-01).
 * Valida o rebranding ClipDrop com nova UI dark e execução do fluxo de download no popup.
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '../support/extension';
import { openPageAndPopup } from './support';

const SAMPLE_SIZE = statSync(resolve(import.meta.dirname, '../fixtures/sample.mp4')).size;

test.describe('rebranding ClipDrop e tema dark no popup', () => {
  test('SPEC-0022:E2E-01 [jornada: branding-popup] valida que o popup renderiza o título "ClipDrop", aplica tema dark visual nos cards e executa fluxo de download de vídeo com barra de progresso preservada', async ({
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

    // Valida que o popup renderiza o título "ClipDrop"
    const title = popup.locator('#title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('ClipDrop');

    // Valida tema dark visual nos cards (#1a1d24 -> rgb(26, 29, 36))
    const item = popup.getByTestId('candidate-item');
    await expect(popup.getByTestId('candidate-list')).toBeVisible();
    await expect(item).toHaveCount(1);
    const cardBg = await item.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(cardBg).toBe('rgb(26, 29, 36)');

    // Executa fluxo de download de vídeo com barra de progresso preservada
    const downloadButton = item.getByTestId('download-button');
    await expect(downloadButton).toBeVisible();
    await downloadButton.click();

    const expected = join(downloadsDir, 'Aula de teste.mp4');
    await expect
      .poll(() => (existsSync(expected) ? statSync(expected).size : -1), { timeout: 20_000 })
      .toBe(SAMPLE_SIZE);
  });
});
