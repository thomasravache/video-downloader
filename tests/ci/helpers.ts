import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

export function run(cmd: string, args: string[], timeout = 120_000) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}`, error: r.error };
}

export function workflowFiles(): string[] {
  if (!existsSync(WORKFLOWS_DIR)) return [];
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
}

export function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf8');
}

/** Linhas de código do YAML sem comentários de linha inteira. */
export function codeLines(text: string): string[] {
  return text.split('\n').filter((l) => !/^\s*#/.test(l));
}
