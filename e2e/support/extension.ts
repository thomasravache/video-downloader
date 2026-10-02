import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, test as base } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { ensureBuilt } from './build';
import { startFixtureServer } from './fixture-server';
import type { Flavor } from './flavor';
import {
  prepareTestExtension,
  seedDownloadPreferences,
  useDefaultDownloadBehavior,
} from './test-profile';

export type { Flavor } from './flavor';

/** Opções configuráveis por projeto no playwright.config.ts. */
export interface ExtensionOptions {
  flavor: Flavor;
  /**
   * Padrões de host (ex.: 'http://localhost/*') que a CÓPIA de teste do build `public` recebe em
   * `host_permissions`, além de http://127.0.0.1/*, simulando uma concessão de acesso por site
   * (o diálogo nativo de permissão não é automatizável). Padrão: nenhum. SPEC-0009:E2E-03.
   */
  grantedHostPatterns: string[];
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

/** `localhost` é a segunda origem das fixtures de iframe (SPEC-0009); ambos resolvem para a máquina local. */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

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
  grantedHostPatterns: [[], { option: true }],

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

  context: async ({ flavor, downloadsDir, grantedHostPatterns }, use) => {
    // Cópia do build; no `public` ganha host_permissions só para os testes (Emenda 1 (teste) da SPEC-0005).
    const extensionPath = prepareTestExtension(
      ensureBuilt(flavor),
      join(mkdtempSync(join(tmpdir(), 'vd-e2e-extension-')), 'extension'),
      flavor,
      grantedHostPatterns,
    );
    const userDataDir = mkdtempSync(join(tmpdir(), 'vd-e2e-profile-'));
    seedDownloadPreferences(userDataDir, downloadsDir);
    const context = await chromium.launchPersistentContext(userDataDir, {
      // Extensões exigem o Chromium completo (novo headless), não o headless shell.
      channel: 'chromium',
      acceptDownloads: true,
      downloadsPath: downloadsDir,
      args: [
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    // Isolamento de rede: nada sai de 127.0.0.1/localhost (defesa em duas camadas: resolver + route).
    await context.route(
      (url) => /^https?:$/.test(url.protocol) && !ALLOWED_HOSTS.has(url.hostname),
      (route) => route.abort('blockedbyclient'),
    );
    context.on('page', settleFailedNavigations);
    await useDefaultDownloadBehavior(context);
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(dirname(extensionPath), { recursive: true, force: true });
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
