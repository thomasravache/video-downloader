import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function run(cmd: string, args: string[], timeout = 120_000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout });
  return { code: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}
