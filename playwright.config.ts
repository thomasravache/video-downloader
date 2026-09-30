import { defineConfig } from '@playwright/test';
import type { ExtensionOptions } from './e2e/support/extension';

export default defineConfig<ExtensionOptions>({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  globalSetup: './e2e/support/global-setup.ts',
  // Teste instável vai para quarentena (ADR-0002): sem retries.
  retries: 0,
  // Uma extensão por contexto persistente; execução serial é mais estável e ainda < 60 s.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  projects: [
    { name: 'public', use: { flavor: 'public' } },
    // IT-03 do harness é específico do flavor public (asserta flavor === 'public').
    { name: 'local', use: { flavor: 'local' }, grepInvert: /SPEC-0003:IT-03/ },
  ],
});
