// SPEC-0006 — garante que o build public não contém providers sem 'public' (ADR-0011).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface FlavorGuardOptions {
  distDir: string;
  /** Diretório(s) cujos subdiretórios contêm `provider.json` (ex.: src/providers e PROVIDERS_EXTRA_DIR). */
  providersDir: string | readonly string[];
}

const FLAVORS = ['public', 'local'];

interface ProviderManifest {
  id: string;
  flavors: string[];
}

function invalid(file: string, why: string): Error {
  return new Error(`INVALID_PROVIDER_MANIFEST: ${file}: ${why}`);
}

function readManifest(file: string): ProviderManifest {
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
  if (typeof id !== 'string' || id === '') throw invalid(file, '"id" deve ser string não vazia');
  if (!Array.isArray(flavors) || flavors.length === 0) {
    throw invalid(file, '"flavors" deve ser uma lista não vazia');
  }
  if (!flavors.every((f) => typeof f === 'string' && FLAVORS.includes(f))) {
    throw invalid(file, `"flavors" só aceita ${FLAVORS.join(', ')}`);
  }
  return { id, flavors: flavors as string[] };
}

function loadManifests(providersDir: string | readonly string[]): ProviderManifest[] {
  const dirs = typeof providersDir === 'string' ? [providersDir] : providersDir;
  const manifests: ProviderManifest[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name, 'provider.json');
      if (entry.isDirectory() && existsSync(file)) manifests.push(readManifest(file));
    }
  }
  return manifests;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** Lança "FORBIDDEN_PROVIDER_IN_PUBLIC:<id>", "INVALID_PROVIDER_MANIFEST..." ou "DIST_NOT_FOUND"; síncrono. */
export function checkFlavorGuard({ distDir, providersDir }: FlavorGuardOptions): void {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`DIST_NOT_FOUND: ${distDir}`);
  }
  const forbidden = [
    ...new Set(
      loadManifests(providersDir)
        .filter((m) => !m.flavors.includes('public'))
        .map((m) => m.id),
    ),
  ];
  if (forbidden.length === 0) return;
  for (const file of walk(distDir)) {
    const content = readFileSync(file, 'latin1');
    const leaked = forbidden.find((id) => content.includes(id));
    if (leaked !== undefined) {
      throw new Error(`FORBIDDEN_PROVIDER_IN_PUBLIC:${leaked} (${file})`);
    }
  }
}
