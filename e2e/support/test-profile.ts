/**
 * Preparação do ambiente de teste E2E (só harness; nada daqui entra no build distribuído).
 *
 *  - `prepareTestExtension`: CÓPIA do build. No flavor `public` recebe
 *    `host_permissions: ["http://127.0.0.1/*", ...grantedHostPatterns]` (Emenda 1 (teste) da
 *    SPEC-0005: o Playwright não consegue conceder `activeTab`; `grantedHostPatterns` simula a
 *    concessão de acesso por site, SPEC-0009). No flavor `local` o manifesto entregue já tem
 *    host_permissions http(s) e não é alterado. O build em `.output/` nunca é modificado.
 *  - `seedDownloadPreferences` + `useDefaultDownloadBehavior`: o `downloadsPath` do Playwright
 *    renomeia os arquivos para GUIDs; com as preferências do perfil + `Browser.setDownloadBehavior`
 *    `default` o Chromium grava em `downloadsDir` com o nome pedido (`chrome.downloads`).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import type { Flavor } from './flavor';

const TEST_HOST_PERMISSION = 'http://127.0.0.1/*';

export function prepareTestExtension(
  builtDir: string,
  targetDir: string,
  flavor: Flavor,
  grantedHostPatterns: readonly string[] = [],
): string {
  cpSync(builtDir, targetDir, { recursive: true });
  if (flavor === 'local') {
    return targetDir;
  }
  const manifestPath = join(targetDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest['host_permissions'] = [TEST_HOST_PERMISSION, ...grantedHostPatterns];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return targetDir;
}

export function seedDownloadPreferences(userDataDir: string, downloadsDir: string): void {
  const profileDir = join(userDataDir, 'Default');
  mkdirSync(profileDir, { recursive: true });
  const preferences = {
    download: { default_directory: downloadsDir, prompt_for_download: false },
    savefile: { default_directory: downloadsDir },
  };
  writeFileSync(join(profileDir, 'Preferences'), JSON.stringify(preferences));
}

export async function useDefaultDownloadBehavior(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());
  const session = await context.newCDPSession(page);
  await session.send('Browser.setDownloadBehavior', { behavior: 'default' });
}
