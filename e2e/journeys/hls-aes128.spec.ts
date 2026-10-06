/**
 * SPEC-0017:E2E-01, E2E-02, E2E-03 — Jornada de download HLS AES-128 e recusa de DRM no popup.
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { expect, test } from '../support/extension';
import { openFetchingPage, waitForStoredCapture } from './hls-support';
import { expectPortugueseText, openPopupForTab } from './support';

const CLIP_DURATION_SEC = 6;

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

test.describe('HLS com criptografia AES-128 no popup', () => {
  test('SPEC-0017:E2E-01 [jornada: baixar-hls] página com HLS AES-128 no flavor local exibe nota, botão de baixar e salva MP4 válido', async ({
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
      'pages/hls-aes128.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/aes128/master.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);
    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);

    // Nota explicativa AES-128 visível no popup (local)
    const note = item.getByTestId('aes128-note');
    await expect(note).toBeVisible();
    await expectPortugueseText(
      note,
      'Criptografado (AES-128): será descriptografado com a chave da sua sessão',
      serviceWorker,
    );

    // Botão de download habilitado
    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();
    await button.click();

    const progress = item.getByTestId('download-progress');
    await expect(progress).toBeVisible();
    expect(await seriousViolations(popup)).toEqual([]);
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 10_000 });

    // Confere arquivo salvo
    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 10_000 }).toBe(1);
    const [name] = savedMp4(downloadsDir);
    const path = join(downloadsDir, name ?? '');
    await expect
      .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 10_000 })
      .toBeGreaterThan(10_000);

    const info = inspectMp4(new Uint8Array(readFileSync(path)));
    expect(info.topLevel[0]).toBe('ftyp');
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
  });

  test('SPEC-0017:E2E-02 (guarda: passa antes da mudança) página com HLS AES-128 no flavor public exibe badge de protegido sem botão de download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-aes128.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/aes128/master.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);
    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);

    // No flavor public, aparece como protegido e sem botão de baixar
    await expect(item.getByTestId('badge-encrypted')).toBeVisible();
    await expect(item.getByTestId('download-button')).toHaveCount(0);
    await expect(item.getByTestId('aes128-note')).toHaveCount(0);
  });

  test('SPEC-0017:E2E-03 playlist com KEYFORMAT Widevine no flavor local exibe badge de protegido sem botão de download', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-widevine.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/widevine.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);
    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);

    // DRM verdadeiro é recusado mesmo no flavor local
    await expect(item.getByTestId('badge-encrypted')).toBeVisible();
    await expect(item.getByTestId('download-button')).toHaveCount(0);
    await expect(item.getByTestId('aes128-note')).toHaveCount(0);
  });
});
