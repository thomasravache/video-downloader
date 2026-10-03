/**
 * Um cartão por vídeo: fontes redundantes recolhidas e seletor de áudio (SPEC-0015:E2E-01, E2E-02) nos dois
 * flavors (projetos public/local).
 *
 * Fixtures: e2e/fixtures/hls/course/ (gerada por generate-video.sh com ffmpeg): `master.m3u8` com 2 variantes
 * (`video-hi` 320x180, `video-lo` 160x90) e 2 faixas de áudio no grupo `a1` (English, DEFAULT, idioma `eng`;
 * Português, idioma `por`), cada trilha um fMP4 de arquivo único (`*.mp4` > 100 KiB, servidos com Range/206).
 * Páginas: pages/hls-course.html (busca a master, as 4 playlists e os 4 .mp4 soltos) e
 * pages/hls-course-master.html (só a master); nenhuma tem <video>.
 *
 * Contrato do popup (data-testid):
 *  - E2E-01: o cartão `candidate-item` da master fica em destaque; os 8 redundantes (2 playlists de variante,
 *    2 de áudio, 4 .mp4) ficam em `<details data-testid="related-sources">` FECHADO por padrão, com
 *    `<summary>` "Outras fontes (8)" (pt-BR) / "Other sources (8)" (en) e os 8 `candidate-item` DENTRO dele, com
 *    os botões normais (`download-button`). O agrupamento é refeito quando o resolve da master termina.
 *  - E2E-02: `audio-select` (<select> com <label> "Áudio"/"Audio") quando o grupo da variante tem > 1 faixa:
 *    uma opção por faixa (o texto contém o nome: "English", "Português"), a padrão (English) selecionada;
 *    o download envia `audioIndex` da opção escolhida (o MP4 salvo tem a trilha `por`).
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { expect, test } from '../support/extension';
import { openFetchingPage, waitForStoredCapture } from './hls-support';
import { openPopupForTab } from './support';

const COURSE = resolve(import.meta.dirname, '../fixtures/hls/course');
const fixtureSize = (name: string): number => statSync(join(COURSE, name)).size;
const SUFFIXES = [
  'master.m3u8',
  'video-hi.m3u8',
  'video-lo.m3u8',
  'audio-en.m3u8',
  'audio-pt.m3u8',
  'video-hi.mp4',
  'video-lo.mp4',
  'audio-en.mp4',
  'audio-pt.mp4',
];
/** Playlists de variante (2) + de áudio (2) + arquivos soltos (4). */
const RELATED = 8;

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

test.describe('popup com um cartão por vídeo', () => {
  test('SPEC-0015:E2E-01 [jornada: baixar-hls] master + variantes + áudio + .mp4 soltos: um cartão em destaque e "Outras fontes (8)" fechada, com cartões ainda baixáveis ao abrir; axe limpo aberta e fechada', async ({
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
      'pages/hls-course.html',
    );
    for (const suffix of SUFFIXES) {
      await waitForStoredCapture(serviceWorker, tabId, `/hls/course/${suffix}`);
    }
    const popup = await openPopupForTab(context, extensionId, tabId);

    // O agrupamento chega quando o resolve da master termina.
    const related = popup.getByTestId('related-sources');
    await expect(related).toHaveCount(1, { timeout: 20_000 });

    // Um único cartão fora da seção recolhida: a master, com qualidade e Baixar.
    const outside = popup.locator(
      '[data-testid="candidate-item"]:not([data-testid="related-sources"] *)',
    );
    await expect(outside).toHaveCount(1);
    await expect(outside).toBeVisible();
    await expect(outside).toContainText('master.m3u8');
    await expect(outside.getByTestId('quality-select')).toBeVisible();
    await expect(outside.getByTestId('download-button').first()).toBeEnabled();

    // Seção fechada por padrão, com o contador e os 8 redundantes dentro (nada sumiu).
    expect(await related.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
    const summary = related.locator('summary');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText(
      new RegExp(`^(Outras fontes|Other sources) \\(${String(RELATED)}\\)$`),
    );
    const cards = related.getByTestId('candidate-item');
    await expect(cards).toHaveCount(RELATED);
    await expect(cards.first()).toBeHidden();
    expect(await seriousViolations(popup)).toEqual([]);

    // Aberta: os 8 cartões aparecem, cada um ainda baixável.
    await summary.click();
    expect(await related.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(true);
    for (let i = 0; i < RELATED; i++) {
      const card = cards.nth(i);
      await expect(card).toBeVisible();
      await expect(card.getByTestId('hls-error')).toHaveCount(0);
      await expect(card.getByTestId('download-button')).toBeEnabled({ timeout: 20_000 });
    }
    expect(await seriousViolations(popup)).toEqual([]);

    // Continuam baixáveis de verdade: o arquivo solto vai para a pasta de downloads.
    await cards.filter({ hasText: 'audio-pt.mp4' }).getByTestId('download-button').click();
    const expected = fixtureSize('audio-pt.mp4');
    await expect
      .poll(
        () =>
          filesIn(downloadsDir).filter(
            (f) => !f.endsWith('.crdownload') && statSync(join(downloadsDir, f)).size === expected,
          ).length,
        { timeout: 20_000 },
      )
      .toBe(1);

    // Fechar de novo recolhe (e o axe continua limpo).
    await summary.click();
    expect(await related.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
    expect(await seriousViolations(popup)).toEqual([]);
  });

  test('SPEC-0015:E2E-02 master com áudio en e pt: seletor "Áudio" com os dois nomes (padrão English); escolher o segundo e baixar salva o MP4 com a trilha de áudio `por`', async ({
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
      'pages/hls-course-master.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/course/master.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('hls-error')).toHaveCount(0);
    const select = item.getByTestId('audio-select');
    await expect(select).toBeVisible({ timeout: 20_000 });
    // Rótulo acessível "Áudio"/"Audio" ligado ao seletor.
    await expect(popup.getByLabel(/^(Áudio|Audio)$/)).toHaveAttribute(
      'data-testid',
      'audio-select',
    );
    const options = select.locator('option');
    await expect(options).toHaveCount(2);
    const names = await options.allTextContents();
    expect(names[0]).toContain('English');
    expect(names[1]).toContain('Português');
    await expect(select.locator('option:checked')).toContainText('English');
    expect(await seriousViolations(popup)).toEqual([]);

    await select.selectOption({ label: names[1] ?? '' });
    await expect(select.locator('option:checked')).toContainText('Português');

    await item.getByTestId('download-button').click();
    const progress = item.getByTestId('download-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(item.getByTestId('job-error')).toHaveCount(0);

    await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
    const [name] = savedMp4(downloadsDir);
    const path = join(downloadsDir, name ?? '');
    await expect
      .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 20_000 })
      .toBeGreaterThan(100_000);

    const info = inspectMp4(new Uint8Array(readFileSync(path)));
    expect(info.tracks).toHaveLength(2);
    expect(info.tracks.map((t) => t.handler).sort()).toEqual(['soun', 'vide']);
    const video = info.tracks.find((t) => t.handler === 'vide');
    expect([video?.width, video?.height]).toEqual([320, 180]);
    expect(info.tracks.find((t) => t.handler === 'soun')?.language).toBe('por');
  });
});
