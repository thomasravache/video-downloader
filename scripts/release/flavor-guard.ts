// SPEC-0006 — garante que o build public não contém providers sem 'public' (ADR-0011).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface FlavorGuardOptions {
  distDir: string;
  /** Diretório(s) cujos subdiretórios contêm `provider.json` (ex.: src/providers e PROVIDERS_EXTRA_DIR). */
  providersDir: string | readonly string[];
}

const FLAVORS = ['public', 'local'];

const ID_PATTERN = /^[a-z][a-z0-9-]{2,}$/;

interface ProviderManifest {
  id: string;
  flavors: string[];
  /** Nome do diretório do provider (usado no caminho `src/providers/<dir>`). */
  dirName: string;
}

function invalid(file: string, why: string): Error {
  return new Error(`INVALID_PROVIDER_MANIFEST: ${file}: ${why}`);
}

function readManifest(file: string, dirName: string): ProviderManifest {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw invalid(
      file,
      `JSON inválido (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const { id, flavors } = obj;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw invalid(file, `"id" deve casar ${String(ID_PATTERN)}`);
  }
  if (!Array.isArray(flavors) || flavors.length === 0) {
    throw invalid(file, '"flavors" deve ser uma lista não vazia');
  }
  if (!flavors.every((f) => typeof f === 'string' && FLAVORS.includes(f))) {
    throw invalid(file, `"flavors" só aceita ${FLAVORS.join(', ')}`);
  }
  return { id, flavors: flavors as string[], dirName };
}

function loadManifests(providersDir: string | readonly string[]): ProviderManifest[] {
  const dirs = typeof providersDir === 'string' ? [providersDir] : providersDir;
  const manifests: ProviderManifest[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(dir, entry.name, 'provider.json');
      if (!existsSync(file)) throw invalid(join(dir, entry.name), 'diretório sem provider.json');
      manifests.push(readManifest(file, entry.name));
    }
  }
  // Sem nenhum diretório configurado não há o que verificar; configurado e vazio é falha.
  if (dirs.length > 0 && manifests.length === 0) {
    throw new Error(`NO_PROVIDERS_FOUND: nenhum provider.json em ${dirs.join(', ')}`);
  }
  return manifests;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** Lança "FORBIDDEN_PROVIDER_IN_PUBLIC:<id>", "INVALID_PROVIDER_MANIFEST...", "NO_PROVIDERS_FOUND" ou "DIST_NOT_FOUND"; síncrono. */
export function checkFlavorGuard({ distDir, providersDir }: FlavorGuardOptions): void {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`DIST_NOT_FOUND: ${distDir}`);
  }
  const manifests = loadManifests(providersDir);
  const files = [...walk(distDir)];
  const map = files.find((file) => file.endsWith('.map'));
  if (map !== undefined) {
    throw new Error(`FORBIDDEN_PROVIDER_IN_PUBLIC: source map no bundle public (${map})`);
  }
  // Um id vaza só como token inteiro (sem letra, dígito, '_' ou '-' colados); o caminho
  // src/providers/<dir> de um provider sem 'public' também conta como vazamento.
  const patterns = manifests
    .filter((m) => !m.flavors.includes('public'))
    .flatMap((m) => [
      { id: m.id, re: new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(m.id)}(?![A-Za-z0-9_-])`) },
      {
        id: m.id,
        re: new RegExp(`src/providers/${escapeRegExp(m.dirName)}(?![A-Za-z0-9_-])`),
      },
    ]);
  if (patterns.length === 0) return;
  for (const file of files) {
    const content = readFileSync(file, 'latin1');
    const leaked = patterns.find((p) => p.re.test(content));
    if (leaked !== undefined) {
      throw new Error(`FORBIDDEN_PROVIDER_IN_PUBLIC:${leaked.id} (${file})`);
    }
  }
}
