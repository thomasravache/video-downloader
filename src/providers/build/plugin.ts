/**
 * Código de build (Node/Vite) do registro de providers (ADR-0011): não entra em nenhum bundle.
 * Descobre `provider.json` em `src/providers/<id>/` (+ `PROVIDERS_EXTRA_DIR`, usado só em testes)
 * e expõe o módulo virtual `virtual:providers` com os providers compatíveis com o flavor do build.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProviderManifest } from '../../core/contracts';
import type { Flavor } from '../../core/contracts';
import { generateRegistrySource } from './generate';
import type { ProviderEntry } from './generate';

export const VIRTUAL_ID = 'virtual:providers';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Subdiretório de `src/providers/` que é código de build, não um provider. */
const NOT_A_PROVIDER = new Set(['build']);

function scan(dir: string, skip: Set<string>): ProviderEntry[] {
  if (!existsSync(dir)) {
    return [];
  }
  const entries: ProviderEntry[] = [];
  for (const name of readdirSync(dir).sort()) {
    const manifestPath = join(dir, name, 'provider.json');
    if (skip.has(name) || !existsSync(manifestPath)) {
      continue;
    }
    const parsed = validateProviderManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
    if (!parsed.ok) {
      throw new Error(`${manifestPath}: ${parsed.error}`);
    }
    const modulePath = join(dir, name, 'index.ts');
    if (!existsSync(modulePath)) {
      throw new Error(`${manifestPath}: falta ${modulePath} (default export = Provider)`);
    }
    entries.push({ ...parsed.value, modulePath });
  }
  return entries;
}

export interface DiscoverOptions {
  /** Raiz do repositório. */
  root: string;
  /** Diretório extra de providers (cada subdiretório com provider.json + index.ts). */
  extraDir?: string;
}

export function discoverProviders(options: DiscoverOptions): ProviderEntry[] {
  const entries = [
    ...scan(join(options.root, 'src/providers'), NOT_A_PROVIDER),
    ...(options.extraDir ? scan(options.extraDir, new Set()) : []),
  ];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`id de provider duplicado: ${entry.id}`);
    }
    seen.add(entry.id);
  }
  return entries;
}

/** Plugin do Vite que serve `virtual:providers` para o flavor do build. */
export function providersPlugin(options: DiscoverOptions & { flavor: Flavor }) {
  return {
    name: 'video-downloader:providers',
    resolveId(id: string): string | undefined {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id: string): string | undefined {
      return id === RESOLVED_ID
        ? generateRegistrySource(discoverProviders(options), options.flavor)
        : undefined;
    },
  };
}

/**
 * O Vitest (WxtVitest) não carrega plugins do `vite` do wxt.config; lá o módulo virtual é um alias
 * para este arquivo gerado (mesmo código do plugin), escrito só quando o conteúdo muda.
 */
export function writeRegistryModule(options: DiscoverOptions & { flavor: Flavor }): string {
  const dir = join(options.root, 'node_modules/.cache/video-downloader');
  const file = join(dir, `providers.${options.flavor}.js`);
  const source = generateRegistrySource(discoverProviders(options), options.flavor);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file) || readFileSync(file, 'utf8') !== source) {
    writeFileSync(file, source);
  }
  return file;
}
