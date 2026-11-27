/**
 * Vídeo que carrega depois de abrir o popup (SPEC-0024:E2E-01) nos dois flavors (projetos public/local).
 *
 * Fixture: pages/hls-late.html não tem autoplay nem `src`; o "player" só pede `/hls/clip/master.m3u8` (o clipe REAL
 * de 6 s de e2e/fixtures/hls/clip/, 360p [índice 0] e 180p [índice 1]) 5 s depois do `load` e então marca
 * `body[data-fetched="done"]`.
 *
 * Contrato do popup assumido (SPEC-0024 §6):
 *  - ao abrir: `detect` como hoje; lista vazia = `empty-state`;
 *  - com o popup aberto ele consulta `network-revision` a cada 1 s e refaz o `detect` quando a revisão muda (e, com
 *    a lista vazia, refaz o `detect` a cada 3 s por até 30 s): o cartão `candidate-item` do HLS aparece SEM reabrir;
 *  - botão "Procurar de novo" (`data-testid="redetect-button"`, papel `button`, nome acessível) sempre visível no
 *    rodapé: o clique refaz o `detect` na hora (o diagnóstico ganha um `detect.start`);
 *  - download HLS como em hls-download.spec.ts (`quality-select`, `download-button`, `download-progress`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { expect, test } from '../support/extension';
import { waitForNetworkObserver } from './hls-support';
import { detectStarts, openPopupForTab, tabIdOf } from './support';

const CLIP_DURATION_SEC = 6;

/** Arquivos .mp4 prontos (sem .crdownload) em `dir`. */
const savedMp4 = (dir: string): string[] => {
  const files = existsSync(dir) ? readdirSync(dir) : [];
  return files.some((f) => f.endsWith('.crdownload'))
    ? []
    : files.filter((f) => f.endsWith('.mp4'));
};

test.describe('vídeo que aparece depois de abrir o popup', () => {
  test('SPEC-0024:E2E-01 [jornada: baixar-hls] o player pede o HLS 5 s depois: o popup aberto mostra a lista vazia e, sem reabrir, o vídeo aparece e baixa um MP4 válido', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    await waitForNetworkObserver(context, serviceWorker, fixturesUrl);
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}pages/hls-late.html`);
    const tabId = await tabIdOf(page, serviceWorker);

    const popup = await openPopupForTab(context, extensionId, tabId);
    await expect(popup.getByTestId('empty-state')).toBeVisible();
    // A lista vazia foi vista ANTES de o player pedir o manifesto.
    await expect(page.locator('body')).not.toHaveAttribute('data-fetched', 'done');

    // Sem reabrir o popup: a re-detecção traz o HLS.
    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('body')).toHaveAttribute('data-fetched', 'done');
    await expect(popup.getByTestId('empty-state')).toHaveCount(0);

    const select = item.getByTestId('quality-select');
    await expect(select.locator('option')).toHaveText([/360p/, /180p/]);
    await select.selectOption('1');
    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();
    await button.click();

    const progress = item.getByTestId('download-progress');
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(item.getByTestId('job-error')).toHaveCount(0);

    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
    const [name] = savedMp4(downloadsDir);
    expect(name).toMatch(/ - 180p\.mp4$/);
    const path = join(downloadsDir, name ?? '');
    await expect
      .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 20_000 })
      .toBeGreaterThan(10_000);
    const info = inspectMp4(new Uint8Array(readFileSync(path)));
    expect(info.topLevel[0]).toBe('ftyp');
    expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'mdat']));
    expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
  });

  test('SPEC-0024:E2E-01 "Procurar de novo" é um botão com nome acessível no rodapé e o clique refaz a detecção na hora', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    const page = await context.newPage();
    await page.goto(`${fixturesUrl}pages/video.html`);
    const tabId = await tabIdOf(page, serviceWorker);
    const popup = await openPopupForTab(context, extensionId, tabId);
    await expect(popup.getByTestId('candidate-item')).toHaveCount(1);

    const redetect = popup.getByTestId('redetect-button');
    await expect(redetect).toBeVisible();
    await expect(redetect).toHaveRole('button');
    await expect(redetect).toHaveAccessibleName(/\S/);
    await expect(popup.locator('footer').getByTestId('redetect-button')).toHaveCount(1);

    const before = await detectStarts(popup);
    await redetect.click();

    await expect.poll(() => detectStarts(popup), { timeout: 2_000 }).toBeGreaterThan(before);
    await expect(popup.getByTestId('candidate-item')).toHaveCount(1);
  });
});
