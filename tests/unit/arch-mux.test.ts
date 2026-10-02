import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT, run } from '../tooling/helpers';

/**
 * Regra de fronteira do ADR-0013 (SPEC-0012): `mux.js` só pode ser importado por entrypoints/offscreen
 * (dependency-cruiser: mux-js-only-in-offscreen). Os arquivos temporários são removidos ao final.
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
const IMPORT_MUX = `import muxjs from 'mux.js';\nexport const t = muxjs;\n`;

describe('pnpm arch: mux.js só no offscreen (ADR-0013)', () => {
  it('SPEC-0012:UT-05 (guarda: passa antes da mudança) src/core importando mux.js falha citando mux-js-only-in-offscreen', () => {
    write('src/core/__arch_mux__/bad.ts', IMPORT_MUX);
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('mux-js-only-in-offscreen');
  });

  it('SPEC-0012:UT-05 (guarda: passa antes da mudança) o popup e o background importando mux.js falham citando mux-js-only-in-offscreen', () => {
    write('entrypoints/popup/__arch_mux__.ts', IMPORT_MUX);
    write('entrypoints/background/__arch_mux__.ts', IMPORT_MUX);
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('mux-js-only-in-offscreen');
  });

  it('SPEC-0012:UT-05 (guarda: passa antes da mudança) entrypoints/offscreen pode importar mux.js sem violação', () => {
    write('entrypoints/offscreen/__arch_mux__.ts', IMPORT_MUX);
    const r = arch();
    expect(r.out).not.toContain('mux-js-only-in-offscreen');
    expect(r.code, r.out).toBe(0);
  });
});
