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

const HOST_PATTERNS = ['http://*/*', 'https://*/*'];
const LOCAL_SUFFIX = ' (local)';

export function resolveFlavor(mode: string): Flavor {
  if (mode === 'public' || mode === 'local') {
    return mode;
  }
  throw new Error(`FLAVOR inválido: "${mode}" (use FLAVOR=public|local ou --mode public)`);
}

export function buildManifest(flavor: Flavor): BuildManifest {
  return {
    manifest_version: 3,
    // runtime.getContexts (offscreen, SPEC-0012) exige Chrome 116+.
    minimum_chrome_version: '116',
    default_locale: 'pt_BR',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    // Permissões mínimas (ADR-0007) sem CSP customizada; `webRequest` só observa (SPEC-0010) e vê
    // apenas os hosts de cada flavor (ADR-0012); `offscreen` (SPEC-0012) hospeda a montagem do HLS.
    permissions: ['activeTab', 'scripting', 'downloads', 'storage', 'webRequest', 'offscreen'],
    // local: acesso amplo; public: opcional, pedido por site com gesto do usuário (popup).
    ...(flavor === 'local'
      ? { host_permissions: [...HOST_PATTERNS] }
      : { optional_host_permissions: [...HOST_PATTERNS] }),
    // O sufixo " (local)" é aplicado em _locales (hook build:done).
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

interface BundleItem {
  type: string;
  fileName?: string;
  code?: string;
  moduleIds?: string[];
  dynamicImports?: string[];
}

/**
 * MPL-2.0 (ADR-0014): o minificador descarta o cabeçalho `/*! ... *\/` da mediabunny (ele fica preso a
 * `import`s que o bundler remove). Este plugin o recoloca no início de todo chunk que contém a biblioteca,
 * lendo o texto do pacote instalado (sem duplicar se já estiver lá). O cabeçalho fica nos chunks com código da
 * mediabunny (o `merge-*.js`, carregado por `import()`) e, por ficar à vista no ponto de uso, também no chunk que
 * os importa (o offscreen); o custo desse segundo cabeçalho é de ~0,5 KB.
 */
export function legalCommentsPlugin(root: string = ROOT) {
  const readHeader = (): string => {
    const file = join(root, 'node_modules/mediabunny/dist/modules/src/index.js');
    const match = /^\s*(\/\*![\s\S]*?\*\/)/.exec(readFileSync(file, 'utf8'));
    if (!match?.[1]) {
      throw new Error('cabeçalho de licença da mediabunny não encontrado');
    }
    return match[1];
  };
  return {
    name: 'preserve-mediabunny-legal',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, BundleItem>): void {
      const chunks = Object.values(bundle).filter(
        (item) => item.type === 'chunk' && item.code !== undefined,
      );
      const withLibrary = new Set(
        chunks
          .filter((c) => c.moduleIds?.some((id) => id.includes('/node_modules/mediabunny/')))
          .map((c) => c.fileName),
      );
      // Também o chunk que a carrega por `import()` (o offscreen): o aviso fica à vista no ponto de uso.
      const marked = chunks.filter(
        (c) =>
          withLibrary.has(c.fileName) || c.dynamicImports?.some((name) => withLibrary.has(name)),
      );
      if (marked.length === 0) {
        return;
      }
      const header = readHeader();
      for (const chunk of marked) {
        const code = chunk.code ?? '';
        // Idempotente: o texto pode já estar no chunk (o bundler às vezes o mantém); nunca duplica.
        if (!code.includes(header)) {
          chunk.code = `${header}\n${code}`;
        }
      }
    },
  };
}

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
    plugins: [providersPlugin(registryOptions(mode)), legalCommentsPlugin()],
  }),
  hooks: {
    'build:done': (wxt) => {
      if (flavorFromEnv(wxt.config.mode) === 'local') {
        suffixLocalNames(wxt.config.outDir);
      }
    },
  },
});
