import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT, run } from '../tooling/helpers';

/**
 * Regra de fronteira do ADR-0014 (SPEC-0014): `mediabunny` só pode ser importado por entrypoints/offscreen
 * (dependency-cruiser: mediabunny-only-in-offscreen). Os arquivos temporários são removidos ao final.
 */
const created: string[] = [];
const createdDirs: string[] = [];

function write(rel: string, content: string): void {
  const abs = join(ROOT, rel);
  let top: string | undefined;
  for (let d = dirname(abs); d !== ROOT && !existsSync(d); d = dirname(d)) top = d;
  if (top) createdDirs.push(top);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  created.push(rel);
}

afterEach(() => {
  for (const rel of created.splice(0)) {
    rmSync(join(ROOT, rel), { force: true });
  }
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const arch = () => run('pnpm', ['arch'], 180_000);
const IMPORT_MB = `import * as mb from 'mediabunny';\nexport const t = mb;\n`;

describe('pnpm arch: mediabunny só no offscreen (ADR-0014)', () => {
  it('SPEC-0014:ADR-0014 src/core importando mediabunny falha citando mediabunny-only-in-offscreen', () => {
    write('src/core/__arch_mb__/bad.ts', IMPORT_MB);
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('mediabunny-only-in-offscreen');
  });

  it('SPEC-0014:ADR-0014 o popup e o background importando mediabunny falham citando mediabunny-only-in-offscreen', () => {
    write('entrypoints/popup/__arch_mb__.ts', IMPORT_MB);
    write('entrypoints/background/__arch_mb__.ts', IMPORT_MB);
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('mediabunny-only-in-offscreen');
  });

  it('SPEC-0014:ADR-0014 entrypoints/offscreen pode importar mediabunny sem violação', () => {
    write('entrypoints/offscreen/__arch_mb__.ts', IMPORT_MB);
    const r = arch();
    expect(r.out).not.toContain('mediabunny-only-in-offscreen');
    expect(r.code, r.out).toBe(0);
  });
});
