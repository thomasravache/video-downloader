/**
 * Contexto de requisição da página para buscar playlists e segmentos recusados com 403 (SPEC-0016:E2E-01,
 * E2E-02), em Chromium REAL.
 *
 * Cenário (hosts de teste, nada sai de 127.0.0.1/localhost): a página (origem A, http://127.0.0.1:<porta>,
 * pages/hls-context-parent.html) embute o player (origem B, http://localhost:<porta>,
 * pages/hls-context-player.html), cujo script busca o master HLS de um TERCEIRO servidor C
 * (e2e/support/context-hls-server.ts, http://localhost:<outra porta>, clipe REAL de e2e/fixtures/hls/clip) que
 * responde 403 a menos que `Origin` = B e `Referer` = B + '/' e registra os cabeçalhos de toda requisição.
 * A requisição da própria página passa (o navegador manda esses cabeçalhos); a da extensão (service worker e
 * offscreen, origem chrome-extension://) só passa se a regra de sessão do declarativeNetRequest fizer o fetch
 * da extensão levar o `Origin`/`Referer` do iframe.
 *
 * Contrato do popup (data-testid, dentro do cartão `candidate-item`): `hls-error` (mensagem do erro de resolve),
 * `download-button`, `download-progress` (data-state) e `job-error`, como nas SPEC-0011/0012. O texto de
 * expiração é a chave i18n `hlsErrorExpired` (public/_locales/{pt_BR,en}/messages.json).
 *
 * E2E-01 é a PROVA DE CONCEITO da SPEC-0016 (fase 1): só no flavor local (a permissão do declarativeNetRequest só
 * existe lá, ADR-0012). E2E-02 roda nos dois flavors: no public o 403 não é repetido (sem a permissão).
 */
import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { inspectMp4 } from '../../tests/unit/support/mp4';
import { startContextHlsServer } from '../support/context-hls-server';
import type { ContextHlsServer } from '../support/context-hls-server';
import { expect, test } from '../support/extension';
import { waitForNetworkObserver, waitForStoredCapture } from './hls-support';
import { openPopupForTab, tabIdOf } from './support';

const CLIP_DURATION_SEC = 6;
const MASTER_PATH = '/clip/master.m3u8';

// O servidor C é `localhost`: o flavor public só o enxerga com a concessão de acesso por site (SPEC-0009).
test.use({ grantedHostPatterns: ['http://localhost/*'] });

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

type Messages = Record<string, { message: string }>;
const localeMessage = (locale: 'pt_BR' | 'en', key: string): string => {
  const file = join(import.meta.dirname, `../../public/_locales/${locale}/messages.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as Messages)[key]?.message ?? '';
};
const expiredTexts = (): string[] => [
  localeMessage('pt_BR', 'hlsErrorExpired'),
  localeMessage('en', 'hlsErrorExpired'),
];
const fetchTexts = (): string[] => [
  localeMessage('pt_BR', 'hlsErrorFetch'),
  localeMessage('en', 'hlsErrorFetch'),
];

/** Origem B (o iframe do player): mesmo servidor e porta da fixture, outro nome de host. */
const playerOrigin = (fixturesUrl: string): string =>
  `http://localhost:${new URL(fixturesUrl).port}`;

/** Abre a página A (com o iframe B) e espera o script do player terminar de buscar o master. */
async function openParent(
  context: Parameters<typeof waitForNetworkObserver>[0],
  serviceWorker: Parameters<typeof waitForNetworkObserver>[1],
  fixturesUrl: string,
  cdn: ContextHlsServer,
): Promise<number> {
  await waitForNetworkObserver(context, serviceWorker, fixturesUrl);
  const page = await context.newPage();
  const source = encodeURIComponent(`${cdn.url}${MASTER_PATH.slice(1)}`);
  await page.goto(`${fixturesUrl}pages/hls-context-parent.html?src=${source}`);
  await expect(page.frameLocator('#player-frame').locator('body')).toHaveAttribute(
    'data-fetched',
    'done',
  );
  return tabIdOf(page, serviceWorker);
}

test.describe('contexto de requisição da página', () => {
  test('SPEC-0016:E2E-01 [jornada: baixar-hls] iframe de outra origem e CDN que exige Origin/Referer: o cartão resolve, o download termina e o .mp4 salvo é válido', async ({
    flavor,
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    test.skip(flavor !== 'local', 'o contexto de requisição só existe no flavor local (ADR-0012)');
    const origin = playerOrigin(fixturesUrl);
    const cdn = await startContextHlsServer({ allowedOrigin: origin, mode: 'enforce' });
    try {
      const tabId = await openParent(context, serviceWorker, fixturesUrl, cdn);
      await waitForStoredCapture(serviceWorker, tabId, MASTER_PATH);
      const popup = await openPopupForTab(context, extensionId, tabId);

      const item = popup.getByTestId('candidate-item');
      await expect(item).toHaveCount(1);
      // O cartão RESOLVE (sem "Não foi possível ler a playlist"): a busca da extensão levou o contexto.
      await expect(item.getByTestId('hls-loading')).toHaveCount(0, { timeout: 15_000 });
      await expect(item.getByTestId('hls-error')).toHaveCount(0);
      await expect(item.getByTestId('download-button')).toBeEnabled();
      expect(await seriousViolations(popup)).toEqual([]);

      await item.getByTestId('download-button').click();
      const progress = item.getByTestId('download-progress');
      await expect(progress).toBeVisible();
      await expect(progress).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
      await expect(progress).toHaveAttribute('aria-valuenow', '100');
      await expect(item.getByTestId('job-error')).toHaveCount(0);

      await expect.poll(() => savedMp4(downloadsDir).length, { timeout: 20_000 }).toBe(1);
      const [name] = savedMp4(downloadsDir);
      const path = join(downloadsDir, name ?? '');
      await expect
        .poll(() => (existsSync(path) ? statSync(path).size : 0), { timeout: 20_000 })
        .toBeGreaterThan(10_000);
      const info = inspectMp4(new Uint8Array(readFileSync(path)));
      expect(info.topLevel[0]).toBe('ftyp');
      expect(info.topLevel).toEqual(expect.arrayContaining(['moov', 'mdat']));
      expect(info.tracks.some((t) => t.handler === 'vide')).toBe(true);
      expect(Math.abs(info.durationSec - CLIP_DURATION_SEC)).toBeLessThan(0.6);

      // O que o servidor viu: a página passou; a 1ª tentativa da extensão foi recusada; as seguintes (playlists
      // E segmentos) levaram exatamente o contexto do iframe e foram atendidas.
      const seen = cdn.requests;
      const page = seen.find((r) => r.path === MASTER_PATH);
      expect(page, 'a requisição da própria página ao master').toMatchObject({
        origin,
        referer: `${origin}/`,
        status: 200,
      });
      const firstRefused = seen.findIndex((r) => r.status === 403);
      expect(firstRefused, 'houve uma primeira tentativa recusada').toBeGreaterThan(0);
      expect(seen.filter((r) => r.status === 403).every((r) => r.origin !== origin)).toBe(true);
      const afterwards = seen.slice(firstRefused + 1).filter((r) => r.status === 200);
      for (const r of afterwards) {
        expect(r, r.path).toMatchObject({ origin, referer: `${origin}/` });
      }
      expect(afterwards.some((r) => r.path === MASTER_PATH)).toBe(true);
      expect(afterwards.some((r) => r.path.endsWith('.mpegts'))).toBe(true);
      expect(seen.some((r) => r.hasCookie)).toBe(false);
    } finally {
      await cdn.close();
    }
  });

  test('SPEC-0016:E2E-02 CDN que recusa sempre (token expirado): o cartão mostra o texto de expiração, no máximo 2 requisições por playlist e axe sem violações sérias', async ({
    flavor,
    context,
    serviceWorker,
    extensionId,
    fixturesUrl,
    downloadsDir,
  }) => {
    const origin = playerOrigin(fixturesUrl);
    const cdn = await startContextHlsServer({ allowedOrigin: origin, mode: 'expire-after-first' });
    try {
      const tabId = await openParent(context, serviceWorker, fixturesUrl, cdn);
      await waitForStoredCapture(serviceWorker, tabId, MASTER_PATH);
      const popup = await openPopupForTab(context, extensionId, tabId);

      const item = popup.getByTestId('candidate-item');
      await expect(item).toHaveCount(1);
      const error = item.getByTestId('hls-error');
      await expect(error).toBeVisible({ timeout: 15_000 });
      await expect(item.getByTestId('download-button')).toHaveCount(0);
      const text = (await error.textContent())?.trim() ?? '';
      // O erro de resolve traz o status HTTP (403) em qualquer flavor (contrato §6): texto de expiração
      // (chave hlsErrorExpired nos dois locales), NÃO o erro genérico de leitura da playlist.
      expect(
        expiredTexts().every((t) => t !== ''),
        'hlsErrorExpired existe nos dois locales',
      ).toBe(true);
      expect(expiredTexts()).toContain(text);
      expect(fetchTexts()).not.toContain(text);
      expect(await seriousViolations(popup)).toEqual([]);

      // 1 requisição da página + no máximo 2 da extensão (a simples e a única repetição) por playlist.
      const master = cdn.requests.filter((r) => r.path === MASTER_PATH);
      expect(master[0]).toMatchObject({ origin, status: 200 });
      expect(master.length - 1).toBeLessThanOrEqual(2);
      expect(master.length - 1).toBeGreaterThanOrEqual(1);
      expect(master.slice(1).every((r) => r.status === 403)).toBe(true);
      if (flavor === 'local') {
        // A repetição com o contexto aconteceu (e foi recusada de novo): 2 tentativas da extensão.
        expect(master).toHaveLength(3);
        expect(master[2]).toMatchObject({ origin, referer: `${origin}/` });
      } else {
        // public: sem a permissão do declarativeNetRequest não há repetição (1 tentativa da extensão).
        expect(master).toHaveLength(2);
      }
      expect(cdn.requests.filter((r) => r.path.endsWith('.mpegts'))).toEqual([]);
      expect(savedMp4(downloadsDir)).toEqual([]);
    } finally {
      await cdn.close();
    }
  });
});
