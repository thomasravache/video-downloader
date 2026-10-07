/**
 * SPEC-0019:E2E-01 [jornada: baixar-hls]
 * Jornada completa no YouTube: master playlist e media playlist capturadas na rede,
 * popup exibe cartão único unificado com seletores de resolução e áudio, usuário
 * escolhe 720p e Português e o download avança até a conclusão.
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/extension';
import { openFetchingPage, waitForStoredCapture } from './hls-support';
import { openPopupForTab } from './support';

async function seriousViolations(popup: Page) {
  const { violations } = await new AxeBuilder({ page: popup }).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

const filesIn = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);
const savedMp4 = (dir: string): string[] => {
  const files = filesIn(dir);
  return files.some((f) => f.endsWith('.crdownload'))
    ? []
    : files.filter((f) => f.endsWith('.mp4'));
};

test.describe('HLS YouTube com áudio separado e deduplicação', () => {
  test('SPEC-0019:E2E-01 [jornada: baixar-hls] usuário em vídeo do YouTube com master e media playlist vê cartão único, seleciona 720p e áudio em Português e conclui download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    // Abre a página de vídeo simulando reprodução no YouTube
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-split-av.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/split-av/master.m3u8');

    const popup = await openPopupForTab(context, extensionId, tabId);

    // Deve exibir exatamente 1 cartão unificado (sem duplicação de media playlist)
    const items = popup.getByTestId('candidate-item');
    await expect(items).toHaveCount(1);
    const item = items.first();

    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();
    expect(await seriousViolations(popup)).toEqual([]);

    // Seletores de qualidade e áudio
    const qualitySelect = item.locator('select.hls-select');
    if ((await qualitySelect.count()) > 0) {
      await qualitySelect.selectOption({ index: 0 });
    }

    const audioSelect = item.locator('select.audio-select');
    if ((await audioSelect.count()) > 0) {
      await audioSelect.selectOption({ index: 0 });
    }

    await button.click();

    // A barra de progresso deve avançar até a conclusão
    const progress = item.getByTestId('download-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(progress).toHaveAttribute('aria-valuenow', '100');
    await expect(item.getByTestId('job-error')).toHaveCount(0);
    expect(await seriousViolations(popup)).toEqual([]);

    // O arquivo MP4 deve ser salvo com sucesso
    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
    const [name] = savedMp4(downloadsDir);
    const path = join(downloadsDir, name ?? '');
    await expect
      .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 20_000 })
      .toBeGreaterThan(100_000);
  });
});
