import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, test as base } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { ensureBuilt } from './build';
import { startFixtureServer } from './fixture-server';
import type { Flavor } from './flavor';

export type { Flavor } from './flavor';

/** Opções configuráveis por projeto no playwright.config.ts. */
export interface ExtensionOptions {
  flavor: Flavor;
}

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  openPopup: () => Promise<Page>;
  downloadsDir: string;
}

interface WorkerFixtures {
  fixturesUrl: string;
}

const ALLOWED_HOST = '127.0.0.1';

/**
 * Após um `goto` abortado, o Chromium ainda confirma (commit) a página de erro de forma assíncrona;
 * um `goto` logo em seguida na mesma página falha com "interrupted by another navigation to
 * chrome-error://". Este wrapper só devolve o erro depois que a página de erro foi confirmada.
 */
function settleFailedNavigations(page: Page): void {
  const goto = page.goto.bind(page);
  page.goto = async (...args: Parameters<Page['goto']>) => {
    try {
      return await goto(...args);
    } catch (error) {
      await page.waitForURL(/^chrome-error:/, { timeout: 5_000 }).catch(() => undefined);
      throw error;
    }
  };
}

export const test = base.extend<ExtensionOptions & ExtensionFixtures, WorkerFixtures>({
  flavor: ['public', { option: true }],

  fixturesUrl: [
    async ({}, use) => {
      const server = await startFixtureServer();
      await use(server.url);
      await server.close();
    },
    { scope: 'worker' },
  ],

  downloadsDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'vd-e2e-downloads-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },

  context: async ({ flavor, downloadsDir }, use) => {
    const extensionPath = ensureBuilt(flavor);
    const userDataDir = mkdtempSync(join(tmpdir(), 'vd-e2e-profile-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Extensões exigem o Chromium completo (novo headless), não o headless shell.
      channel: 'chromium',
      acceptDownloads: true,
      downloadsPath: downloadsDir,
      args: [
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    // Isolamento de rede: nada sai de 127.0.0.1 (defesa em duas camadas: resolver + route).
    await context.route(
      (url) => /^https?:$/.test(url.protocol) && url.hostname !== ALLOWED_HOST,
      (route) => route.abort('blockedbyclient'),
    );
    context.on('page', settleFailedNavigations);
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  openPopup: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      return page;
    });
  },
});

export const expect = test.expect;
