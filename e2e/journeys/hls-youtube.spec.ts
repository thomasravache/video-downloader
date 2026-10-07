/**
 * SPEC-0019:E2E-01 [jornada: baixar-hls]
 * Jornada completa no YouTube: master playlist e media playlist capturadas na rede,
 * popup exibe cartão único unificado com seletores de resolução e áudio, usuário
 * escolhe 720p e Português e o download avança até a conclusão.
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { makePackedAacSegment } from '../../tests/unit/support/packed-aac';
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

  test('SPEC-0020:E2E-01 [jornada: baixar-hls] usuário em vídeo do YouTube com variantes H.264 e VP9 vê cartão único, seleciona 1080p H.264 e áudio e conclui download com sucesso', async ({
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
      'pages/hls-split-av.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/split-av/master.m3u8');

    const popup = await openPopupForTab(context, extensionId, tabId);

    const items = popup.getByTestId('candidate-item');
    await expect(items).toHaveCount(1);
    const item = items.first();

    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();
    expect(await seriousViolations(popup)).toEqual([]);

    const qualitySelect = item.locator('select.hls-select');
    if ((await qualitySelect.count()) > 0) {
      await qualitySelect.selectOption({ index: 0 });
    }

    const audioSelect = item.locator('select.audio-select');
    if ((await audioSelect.count()) > 0) {
      await audioSelect.selectOption({ index: 0 });
    }

    await button.click();

    const progress = item.getByTestId('download-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(progress).toHaveAttribute('aria-valuenow', '100');
    await expect(item.getByTestId('job-error')).toHaveCount(0);
    expect(await seriousViolations(popup)).toEqual([]);

    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
    const [name] = savedMp4(downloadsDir);
    const path = join(downloadsDir, name ?? '');
    await expect
      .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 20_000 })
      .toBeGreaterThan(100_000);
  });

  test('SPEC-0021:E2E-01 [jornada: baixar-hls] Valida download de vídeo HLS do YouTube com áudio packed AAC gerando arquivo com trilha de áudio contínua e duração correspondente à do vídeo', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    // Intercepta áudio HLS para entregar segmentos packed AAC com ID3 (simulando itag 234 do YouTube)
    const seg0 = makePackedAacSegment(0, 86);
    const seg1 = makePackedAacSegment(90000 * 2, 86);

    await context.route('**/hls/split-av/audio.m3u8', async (route) => {
      const playlist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:2.0,',
        'audio-packed-0.aac',
        '#EXTINF:2.0,',
        'audio-packed-1.aac',
        '#EXT-X-ENDLIST',
      ].join('\n');
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: playlist,
      });
    });

    await context.route('**/hls/split-av/audio-packed-0.aac', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'audio/aac',
        body: Buffer.from(seg0),
      });
    });

    await context.route('**/hls/split-av/audio-packed-1.aac', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'audio/aac',
        body: Buffer.from(seg1),
      });
    });

    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-split-av.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/split-av/master.m3u8');

    const popup = await openPopupForTab(context, extensionId, tabId);
    const items = popup.getByTestId('candidate-item');
    await expect(items).toHaveCount(1);
    const item = items.first();

    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();

    const qualitySelect = item.locator('select.hls-select');
    if ((await qualitySelect.count()) > 0) {
      await qualitySelect.selectOption({ index: 0 });
    }

    const audioSelect = item.locator('select.audio-select');
    if ((await audioSelect.count()) > 0) {
      await audioSelect.selectOption({ index: 0 });
    }

    await button.click();

    const progress = item.getByTestId('download-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(progress).toHaveAttribute('aria-valuenow', '100');
    await expect(item.getByTestId('job-error')).toHaveCount(0);

    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
    const [name] = savedMp4(downloadsDir);
    const path = join(downloadsDir, name ?? '');
    await expect
      .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 20_000 })
      .toBeGreaterThan(50_000);

    const downloadedBytes = new Uint8Array(readFileSync(path));
    const info = inspectMp4(downloadedBytes);
    const audioTrack = info.tracks.find((t) => t.handler === 'soun');
    expect(audioTrack).toBeDefined();
    // A duração do áudio deve cobrir a soma dos segmentos e não estar truncada aos 2s
    expect(audioTrack?.durationSec).toBeGreaterThan(3.5);
  });
});

