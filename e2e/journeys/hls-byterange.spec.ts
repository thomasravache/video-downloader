/**
 * HLS de arquivo único com byte range e popup sem ruído (SPEC-0013:E2E-01, E2E-02) nos dois flavors.
 *
 * Fixtures: e2e/fixtures/hls/single-file/ (media.mp4 + media.m3u8 gerados por generate-video.sh com
 * `-hls_segment_type fmp4 -hls_flags single_file`: clipe sintético de 6 s, 320x180, H.264 + AAC; a playlist
 * usa EXT-X-MAP/EXT-X-BYTERANGE sobre o mesmo arquivo, servido com Range/206 por e2e/support/fixture-server.ts):
 *  - pages/hls-byterange.html: busca a playlist (`fetch`), sem <video>;
 *  - pages/mse-hls-network.html: <video> com src blob: (MediaSource) + fetch da playlist HLS;
 *  - pages/hls-as-file.html: <video preload="none" src=".../media.m3u8?sig=pagina"> (o DOM vê um "arquivo")
 *    + fetch da MESMA playlist com `?sig=rede` (a rede vê o HLS); título da página "Aula com master vista
 *    como arquivo";
 *  - pages/blob-stream.html: só <video> blob:.
 *
 * Contrato do popup (data-testid, como na SPEC-0012): `candidate-item`, `download-button`, `download-progress`
 * (`data-state`, aria-valuenow), `job-error`, `badge-unsupported`; o título do cartão fica em `.card-title`.
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { expect, test } from '../support/extension';
import { openFetchingPage, waitForStoredCapture } from './hls-support';
import { expectPortugueseText, openPageAndPopup, openPopupForTab } from './support';

const CLIP_DURATION_SEC = 6;
const MAX_DOWNLOAD_MS = 10_000;

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

test.describe('HLS com byte range e popup sem ruído', () => {
  test('SPEC-0013:E2E-01 [jornada: baixar-hls] HLS de arquivo único (byte range): progresso, .mp4 salvo e válido (320x180, ~6 s) em menos de 10 s', async ({
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
      'pages/hls-byterange.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/single-file/media.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);
    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();
    await expect(item.getByTestId('hls-error')).toHaveCount(0);

    const startedAt = Date.now();
    await button.click();

    const progress = item.getByTestId('download-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('role', 'progressbar');
    await expect(progress).toHaveAttribute('aria-valuemin', '0');
    await expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(await seriousViolations(popup)).toEqual([]);
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(progress).toHaveAttribute('aria-valuenow', '100');
    await expect(item.getByTestId('job-error')).toHaveCount(0);
    await expectPortugueseText(item, 'Salvo como', serviceWorker);
    expect(await seriousViolations(popup)).toEqual([]);

    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
    const [name] = savedMp4(downloadsDir);
    const path = join(downloadsDir, name ?? '');
    await expect
      .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 20_000 })
      .toBeGreaterThan(10_000);
    const elapsed = Date.now() - startedAt;
    test.info().annotations.push({ type: 'tempo do download (ms)', description: String(elapsed) });
    expect(elapsed).toBeLessThan(MAX_DOWNLOAD_MS);

    const info = inspectMp4(new Uint8Array(readFileSync(path)));
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'mdat']));
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
    const videos = info.tracks.filter((t) => t.handler === 'vide');
    expect(videos).toHaveLength(1);
    expect([videos[0]?.width, videos[0]?.height]).toEqual([320, 180]);
  });

  test('SPEC-0013:E2E-02 página com <video> blob: e HLS observado na rede: o popup não mostra o cartão blob (nem badge-unsupported)', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/mse-hls-network.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/single-file/media.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item.filter({ hasText: 'HLS' })).toHaveCount(1);
    await expect(item.getByTestId('download-button')).toBeEnabled();
    await expect(popup.getByTestId('badge-unsupported')).toHaveCount(0);
    await expect(item).toHaveCount(1);
    expect(await seriousViolations(popup)).toEqual([]);
  });

  test('SPEC-0013:E2E-02 <video src> com a mesma playlist (query diferente da rede): um único cartão HLS com o título da página, sem Download do texto da playlist', async ({
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
      'pages/hls-as-file.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/single-file/media.m3u8?sig=rede');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item.filter({ hasText: 'HLS' })).toHaveCount(1);
    await expect(item.getByTestId('download-button')).toBeEnabled();
    await expect(item).toHaveCount(1);
    await expect(item.locator('.card-title')).toHaveText('Aula com master vista como arquivo');
    await expect(popup.getByTestId('download-button')).toHaveCount(1);

    // O download é o do HLS (MP4 válido), nunca o texto da playlist.
    await item.getByTestId('download-button').click();
    await expect(item.getByTestId('download-progress')).toHaveAttribute('data-state', 'done', {
      timeout: 20_000,
    });
    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
    const path = join(downloadsDir, savedMp4(downloadsDir)[0] ?? '');
    expect(inspectMp4(new Uint8Array(readFileSync(path))).topLevel[0]).toBe('ftyp');
  });

  test('SPEC-0013:E2E-02 (guarda) página só com <video> blob: o cartão blob continua com badge-unsupported', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const { popup } = await openPageAndPopup(
      context,
      serviceWorker,
      extensionId,
      `${fixturesUrl}pages/blob-stream.html`,
    );

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('badge-unsupported')).toBeVisible();
    await expect(popup.getByTestId('download-button')).toHaveCount(0);
  });
});
