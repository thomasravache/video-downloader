import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Flavor } from './flavor';

export const ROOT = resolve(import.meta.dirname, '../..');

export function extensionDir(flavor: Flavor): string {
  return join(ROOT, '.output', `chrome-mv3-${flavor}`);
}

function newestMtime(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  return readdirSync(path).reduce((max, name) => Math.max(max, newestMtime(join(path, name))), 0);
}

const SOURCES = ['src', 'entrypoints', 'public', 'wxt.config.ts', 'package.json'];

/** Builda o flavor se a saída faltar ou estiver mais velha que as fontes (determinístico). */
export function ensureBuilt(flavor: Flavor): string {
  const out = extensionDir(flavor);
  const built = newestMtime(join(out, 'manifest.json'));
  const source = Math.max(...SOURCES.map((s) => newestMtime(join(ROOT, s))));
  if (built === 0 || built < source) {
    const r = spawnSync('pnpm', [`build:${flavor}`], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      throw new Error(`pnpm build:${flavor} falhou (exit ${String(r.status)})`);
    }
  }
  return out;
}
