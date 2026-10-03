/**
 * Vídeo e áudio separados juntados num único MP4 (SPEC-0014:E2E-01, E2E-02) nos dois flavors.
 *
 * Fixtures: e2e/fixtures/hls/split-av/ (gerada por generate-video.sh com ffmpeg): `master.m3u8` com
 * `EXT-X-STREAM-INF ... AUDIO="a1"` + `EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="English",DEFAULT=YES,URI="audio.m3u8"`;
 * `video.mp4` (só H.264, 320x180, 6 s) e `audio.mp4` (só AAC) são fMP4 de ARQUIVO ÚNICO com playlists
 * EXT-X-MAP/EXT-X-BYTERANGE, servidos com Range/206 por e2e/support/fixture-server.ts;
 * `master-enc-audio.m3u8` aponta para `audio-enc.m3u8` (EXT-X-KEY AES-128). Páginas: pages/hls-split-av.html e
 * pages/hls-split-av-encrypted.html (só buscam a master, sem <video>).
 *
 * Contrato do popup (data-testid, dentro do cartão `candidate-item` do HLS):
 *  - `audio-included` (SPEC-0014 §6, em `p.status`): "Inclui áudio: English" (pt-BR) / "Includes audio: English"
 *    (en); só aparece quando a variante selecionada vai juntar áudio;
 *  - `download-button`, `download-progress` (data-state), `badge-encrypted` como nas SPEC-0011/0012;
 *  - o MP4 salvo é conferido por tests/unit/support/mp4.ts (sem ffprobe): 2 trilhas (`vide` 320x180 + `soun`).
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { expect, test } from '../support/extension';
import { openFetchingPage, waitForStoredCapture } from './hls-support';
import { openPopupForTab } from './support';

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

test.describe('vídeo e áudio separados', () => {
  test('SPEC-0014:E2E-01 [jornada: baixar-hls] master com áudio separado: o cartão mostra "Inclui áudio" e o .mp4 salvo tem 2 trilhas (vide 320x180 + soun), ~6 s, em menos de 10 s', async ({
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

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();
    await expect(item.getByTestId('hls-error')).toHaveCount(0);
    const note = item.getByTestId('audio-included');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(/^(Inclui áudio|Includes audio): English$/);
    expect(await seriousViolations(popup)).toEqual([]);

    const startedAt = Date.now();
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
    const elapsed = Date.now() - startedAt;
    test.info().annotations.push({ type: 'tempo do download (ms)', description: String(elapsed) });
    expect(elapsed).toBeLessThan(MAX_DOWNLOAD_MS);

    const info = inspectMp4(new Uint8Array(readFileSync(path)));
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toContain('moov');
    expect(info.tracks).toHaveLength(2);
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
    for (const track of info.tracks) {
      expect(Math.abs(track.durationSec - CLIP_DURATION_SEC), track.handler).toBeLessThan(0.6);
    }
  });

  test('SPEC-0014:E2E-02 master cujo áudio é criptografado: badge-encrypted, sem botão de baixar e sem "Inclui áudio"', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const workerRequests: string[] = [];
    context.on('request', (request) => {
      if (request.serviceWorker()) {
        workerRequests.push(request.url());
      }
    });
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-split-av-encrypted.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/split-av/master-enc-audio.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('badge-encrypted')).toBeVisible();
    await expect(item.getByTestId('download-button')).toHaveCount(0);
    await expect(item.getByTestId('audio-included')).toHaveCount(0);
    await expect(item.getByTestId('hls-loading')).toHaveCount(0);
    expect(await seriousViolations(popup)).toEqual([]);
    expect(savedMp4(downloadsDir)).toEqual([]);

    // O resolve buscou só playlists: master, melhor variante e a playlist de áudio padrão; nenhuma mídia.
    expect([...workerRequests].sort()).toEqual(
      [
        `${fixturesUrl}hls/split-av/master-enc-audio.m3u8`,
        `${fixturesUrl}hls/split-av/video.m3u8`,
        `${fixturesUrl}hls/split-av/audio-enc.m3u8`,
      ].sort(),
    );
  });
});
