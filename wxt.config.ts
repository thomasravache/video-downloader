import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
import { providersPlugin, writeRegistryModule } from './src/providers/build/plugin';

export type Flavor = 'public' | 'local';

export interface BuildManifest {
  manifest_version: 3;
  default_locale: 'pt_BR';
  name: string;
  [key: string]: unknown;
}

const LOCAL_SUFFIX = ' (local)';

export function resolveFlavor(mode: string): Flavor {
  if (mode === 'public' || mode === 'local') {
    return mode;
  }
  throw new Error(`FLAVOR inválido: "${mode}" (use FLAVOR=public|local ou --mode public)`);
}

export function buildManifest(_flavor: Flavor): BuildManifest {
  return {
    manifest_version: 3,
    default_locale: 'pt_BR',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    // Permissões mínimas (ADR-0007): sem host_permissions e sem CSP customizada.
    permissions: ['activeTab', 'scripting', 'downloads', 'storage'],
    // O manifesto é igual nos dois flavors; o sufixo " (local)" é aplicado em _locales (hook build:done).
  };
}

/** Acrescenta " (local)" ao extName de cada locale da saída do build local. */
export function suffixLocalNames(outDir: string): void {
  const localesDir = join(outDir, '_locales');
  if (!existsSync(localesDir)) {
    return;
  }
  for (const locale of readdirSync(localesDir)) {
    const file = join(localesDir, locale, 'messages.json');
    if (!existsSync(file)) {
      continue;
    }
    const messages = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { message: string }>;
    const extName = messages['extName'];
    if (extName && !extName.message.endsWith(LOCAL_SUFFIX)) {
      extName.message += LOCAL_SUFFIX;
      writeFileSync(file, `${JSON.stringify(messages, null, 2)}\n`);
    }
  }
}

/**
 * O Vite proíbe o modo "local" (conflita com .env.local), então o flavor vem da variável FLAVOR
 * (definida pelos scripts do package.json); sem ela, o próprio modo do WXT é o flavor.
 */
export function flavorFromEnv(mode: string): Flavor {
  return resolveFlavor(process.env['FLAVOR'] ?? mode);
}

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function registryOptions(mode: string) {
  const extraDir = process.env['PROVIDERS_EXTRA_DIR'];
  return {
    root: ROOT,
    flavor: flavorFromEnv(mode),
    ...(extraDir !== undefined && extraDir !== '' && { extraDir }),
  };
}

export default defineConfig({
  manifestVersion: 3,
  // O Vitest não aplica os plugins do `vite` abaixo: lá `virtual:providers` vira um alias.
  alias: process.env['VITEST']
    ? { 'virtual:providers': writeRegistryModule(registryOptions('public')) }
    : {},
  outDirTemplate: `{{browser}}-mv{{manifestVersion}}-${process.env['FLAVOR'] ?? '{{mode}}'}`,
  manifest: ({ mode }) => {
    const { manifest_version: _ignored, ...rest } = buildManifest(flavorFromEnv(mode));
    return rest;
  },
  vite: ({ mode }) => ({
    define: {
      'import.meta.env.FLAVOR': JSON.stringify(flavorFromEnv(mode)),
    },
    plugins: [providersPlugin(registryOptions(mode))],
  }),
  hooks: {
    'build:done': (wxt) => {
      if (flavorFromEnv(wxt.config.mode) === 'local') {
        suffixLocalNames(wxt.config.outDir);
      }
    },
  },
});
