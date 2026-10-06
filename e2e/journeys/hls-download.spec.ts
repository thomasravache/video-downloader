/**
 * Baixar HLS no popup (SPEC-0012:E2E-01..E2E-03) nos dois flavors (projetos public/local).
 *
 * Fixtures: e2e/fixtures/hls/clip/ (clipe REAL de 6 s gerado por e2e/fixtures/generate-video.sh: master com
 * 640x360 [360p, índice 0] e 320x180 [180p, índice 1], H.264+AAC, segmentos MPEG-TS de 2 s) servido por
 * pages/hls-clip.html (`/hls/clip/master.m3u8`); pages/hls-slow.html busca o master de outro servidor local
 * (e2e/support/slow-hls-server.ts), que segura as respostas dos segmentos de índice >= 1 até o cliente fechar
 * a conexão; pages/hls-encrypted.html e pages/hls-live.html (SPEC-0011).
 *
 * Contrato do popup assumido (data-testid, dentro do cartão `candidate-item` do HLS):
 *  - `quality-select` + `download-button` (habilitado para HLS resolvido, sem criptografia e VOD);
 *  - ao clicar em Baixar: `download-progress` (role="progressbar", aria-valuemin=0, aria-valuemax=100,
 *    aria-valuenow = JobState.percent) com `data-state` = JobState.state (running | assembling | saving |
 *    done | canceled | error ...) que PERMANECE no cartão até o fim (done e canceled inclusive); texto
 *    "12 de 30" (segmentos) e, ao concluir, "Salvo como <nome>.mp4" (pt-BR);
 *  - `cancel-download` (botão acessível por teclado, nome acessível) enquanto o job está ativo; ao cancelar,
 *    `download-progress` fica com data-state="canceled" (texto "cancelado" em pt-BR) e o progresso congela;
 *  - `job-error` com a mensagem traduzida em caso de erro do job;
 *  - o nome do arquivo termina em " - <rótulo>.mp4" (ex.: " - 180p.mp4") e é salvo em `downloadsDir`.
 *  - o MP4 salvo é conferido com o leitor de caixas de tests/unit/support/mp4.ts (sem ffprobe).
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { expect, test } from '../support/extension';
import { startSlowHlsServer } from '../support/slow-hls-server';
import { openFetchingPage, waitForStoredCapture } from './hls-support';
import { expectPortugueseText, openPopupForTab } from './support';

const CLIP_DURATION_SEC = 6;

async function seriousViolations(popup: Page) {
  const { violations } = await new AxeBuilder({ page: popup }).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

const filesIn = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

/** Arquivos .mp4 prontos (sem .crdownload) em `dir`. */
const savedMp4 = (dir: string): string[] => {
  const files = filesIn(dir);
  return files.some((f) => f.endsWith('.crdownload'))
    ? []
    : files.filter((f) => f.endsWith('.mp4'));
};

/** Move o foco para `target` só com Tab (acessibilidade por teclado); falha se não chegar. */
async function tabTo(page: Page, target: Locator, maxTabs = 25): Promise<void> {
  for (let i = 0; i < maxTabs; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  expect(await target.evaluate((el) => el === document.activeElement), 'foco por teclado').toBe(
    true,
  );
}

test.describe('baixar HLS', () => {
  test('SPEC-0012:E2E-01 [jornada: baixar-hls] escolhe a qualidade, baixa, a barra chega a 100% e o .mp4 salvo é válido', async ({
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
      'pages/hls-clip.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/clip/master.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);
    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    const select = item.getByTestId('quality-select');
    await expect(select.locator('option')).toHaveText([/360p/, /180p/]);

    // A qualidade escolhida (a menor, não a padrão) é a que será baixada.
    await select.selectOption('1');
    await expect(select.locator('option:checked')).toHaveText(/180p/);
    const button = item.getByTestId('download-button');
    await expect(button).toBeEnabled();
    await button.click();

    const progress = item.getByTestId('download-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('role', 'progressbar');
    await expect(progress).toHaveAttribute('aria-valuemin', '0');
    await expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(await seriousViolations(popup)).toEqual([]);
    await expect(progress).toHaveAttribute('aria-valuenow', '100', { timeout: 20_000 });
    await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(item.getByTestId('job-error')).toHaveCount(0);
    await expectPortugueseText(item, 'Salvo como', serviceWorker);
    expect(await seriousViolations(popup)).toEqual([]);

    // Arquivo salvo: um .mp4 com o rótulo da qualidade escolhida, MP4 de verdade.
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
    expect(info.tracks.some((t) => t.handler === 'soun')).toBe(true);
  });

  test('SPEC-0012:E2E-02 cancelar um download em andamento: o progresso para, aparece cancelado, as requisições cessam e nenhum arquivo é salvo', async ({
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const slow = await startSlowHlsServer({ holdFrom: 1 });
    try {
      const source = encodeURIComponent(`${slow.url}clip/master.m3u8`);
      const { tabId } = await openFetchingPage(
        context,
        serviceWorker,
        fixturesUrl,
        `pages/hls-slow.html?src=${source}`,
      );
      await waitForStoredCapture(serviceWorker, tabId, '/clip/master.m3u8');
      const popup = await openPopupForTab(context, extensionId, tabId);
      const item = popup.getByTestId('candidate-item');
      await expect(item).toHaveCount(1);
      const button = item.getByTestId('download-button');
      await expect(button).toBeEnabled();
      await button.click();

      // Segmento 0 baixado, os demais pendurados: o job está ativo e a barra parou antes de 100%.
      const progress = item.getByTestId('download-progress');
      await expect(progress).toBeVisible();
      await expect.poll(() => slow.held(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
      await expect
        .poll(async () => Number(await progress.getAttribute('aria-valuenow')), { timeout: 15_000 })
        .toBeGreaterThan(0);
      await expect(progress).toHaveAttribute('data-state', 'running');
      const cancel = item.getByTestId('cancel-download');
      await expect(cancel).toBeVisible();
      await expect(cancel).toHaveAccessibleName(/\S/);

      // Cancelar só pelo teclado.
      await tabTo(popup, cancel);
      const canceledAt = Date.now();
      await popup.keyboard.press('Enter');

      await expect(progress).toHaveAttribute('data-state', 'canceled', { timeout: 5_000 });
      await expectPortugueseText(item, 'ancelado', serviceWorker);
      const frozen = await progress.getAttribute('aria-valuenow');
      expect(Number(frozen)).toBeLessThan(100);
      // As conexões pendentes são fechadas em < 1 s (NFR).
      await expect.poll(() => slow.held(), { timeout: 1_000 }).toBe(0);
      expect(Date.now() - canceledAt).toBeLessThan(2_500);
      await expect(item.getByTestId('cancel-download')).toHaveCount(0);
      await expect(item.getByTestId('job-error')).toHaveCount(0);

      // Nenhuma requisição nova: o contador de segmentos estabiliza (5 amostras iguais seguidas).
      let last = -1;
      let stable = 0;
      await expect
        .poll(
          () => {
            const now = slow.segmentRequests();
            stable = now === last ? stable + 1 : 0;
            last = now;
            return stable;
          },
          { timeout: 10_000, intervals: [100] },
        )
        .toBeGreaterThanOrEqual(5);
      expect(slow.segmentRequests()).toBeLessThanOrEqual(3);
      expect(slow.held()).toBe(0);
      await expect(progress).toHaveAttribute('aria-valuenow', frozen ?? '');
      await expect(progress).toHaveAttribute('data-state', 'canceled');
      expect(filesIn(downloadsDir)).toEqual([]);
    } finally {
      await slow.close();
    }
  });

  test('SPEC-0012:E2E-03 (guarda: passa antes da mudança) HLS com AES-128: o popup mostra badge-encrypted, nenhum botão de download e nenhum segmento sai', async ({
    flavor,
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
  }) => {
    test.skip(
      flavor !== 'public',
      'a recusa de AES-128 só se aplica ao flavor public após a SPEC-0017',
    );
    const requested: string[] = [];
    context.on('request', (request) => {
      requested.push(request.url());
    });
    const { tabId } = await openFetchingPage(
      context,
      serviceWorker,
      fixturesUrl,
      'pages/hls-encrypted.html',
    );
    await waitForStoredCapture(serviceWorker, tabId, '/hls/encrypted.m3u8');
    const popup = await openPopupForTab(context, extensionId, tabId);

    const item = popup.getByTestId('candidate-item');
    await expect(item).toHaveCount(1);
    await expect(item.getByTestId('badge-encrypted')).toBeVisible();
    await expect(popup.getByTestId('download-button')).toHaveCount(0);
    await expect(popup.getByTestId('download-progress')).toHaveCount(0);

    // Nem segmentos nem chave: só a playlist foi buscada.
    const media = requested.filter((url) => /\.(ts|m4s|mpegts)(\?|$)|key\.bin|enc-\d/.test(url));
    expect(media).toEqual([]);
    // A página e o service worker pedem a mesma playlist; nada além dela.
    expect([...new Set(requested.filter((url) => url.includes('/hls/')))]).toEqual([
      `${fixturesUrl}hls/encrypted.m3u8`,
    ]);
  });

  test('SPEC-0012:E2E-03 a recusa vale no servidor: pedir o download do HLS criptografado ou ao vivo por mensagem responde ENCRYPTED / LIVE e nada é baixado', async ({
    flavor,
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    test.skip(
      flavor !== 'public',
      'a recusa de AES-128 no servidor só se aplica ao flavor public após a SPEC-0017',
    );
    const requested: string[] = [];
    context.on('request', (request) => {
      requested.push(request.url());
    });
    for (const [pagePath, capture, expected] of [
      ['pages/hls-encrypted.html', '/hls/encrypted.m3u8', 'ENCRYPTED'],
      ['pages/hls-live.html', '/hls/live.m3u8', 'LIVE'],
    ] as const) {
      const { tabId } = await openFetchingPage(context, serviceWorker, fixturesUrl, pagePath);
      await waitForStoredCapture(serviceWorker, tabId, capture);
      const popup = await openPopupForTab(context, extensionId, tabId);
      await expect(popup.getByTestId('candidate-item')).toHaveCount(1);
      // Espera o cartão resolver (selo), depois pede o download direto ao background.
      await expect(
        popup.getByTestId(expected === 'ENCRYPTED' ? 'badge-encrypted' : 'badge-live'),
      ).toBeVisible();

      const response = await popup.evaluate(async (tab) => {
        const chromeApi = (
          globalThis as unknown as {
            chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
          }
        ).chrome;
        const detected = (await chromeApi.runtime.sendMessage({ type: 'detect', tabId: tab })) as {
          candidates: { id: string }[];
        };
        return chromeApi.runtime.sendMessage({
          type: 'download',
          candidateId: detected.candidates[0]?.id,
        });
      }, tabId);

      expect(response).toEqual({ ok: false, error: expected });
    }
    expect(
      requested.filter((url) => /\.(ts|m4s|mpegts)(\?|$)|key\.bin|enc-\d|live-\d/.test(url)),
    ).toEqual([]);
    expect(filesIn(downloadsDir)).toEqual([]);
  });
});
