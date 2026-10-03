import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT, run } from '../tooling/helpers';

/**
 * Regra de fronteira (SPEC-0014, ADR-0014; revisão): `entrypoints/offscreen/merge*` (a junção, único módulo que
 * importa a mediabunny) só pode ser importado de dentro de `entrypoints/offscreen/` (dependency-cruiser:
 * offscreen-merge-only-in-offscreen). Também: `mediabunny` fica em devDependencies como as demais bibliotecas
 * empacotadas (m3u8-parser, mux.js), com versão exata.
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
const IMPORT_MERGE = (from: string): string =>
  `import { assembleMerged } from '${from}';\nexport const t = assembleMerged;\n`;

describe('pnpm arch: entrypoints/offscreen/merge só dentro do offscreen (ADR-0014)', () => {
  it('SPEC-0014:ADR-0014 popup e background importando offscreen/merge falham citando offscreen-merge-only-in-offscreen', () => {
    write('entrypoints/popup/__arch_merge__.ts', IMPORT_MERGE('../offscreen/merge'));
    write('entrypoints/background/__arch_merge__.ts', IMPORT_MERGE('../offscreen/merge'));
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('offscreen-merge-only-in-offscreen');
  });

  it('SPEC-0014:ADR-0014 src/core importando offscreen/merge falha citando offscreen-merge-only-in-offscreen', () => {
    write('src/core/__arch_merge__/bad.ts', IMPORT_MERGE('../../../entrypoints/offscreen/merge'));
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('offscreen-merge-only-in-offscreen');
  });

  it('SPEC-0014:ADR-0014 outro módulo do offscreen pode importar offscreen/merge sem violação', () => {
    write('entrypoints/offscreen/__arch_merge__.ts', IMPORT_MERGE('./merge'));
    const r = arch();
    expect(r.out).not.toContain('offscreen-merge-only-in-offscreen');
    expect(r.code, r.out).toBe(0);
  });
});

describe('dependências empacotadas', () => {
  it('SPEC-0014:ADR-0008 mediabunny fica em devDependencies, junto de m3u8-parser e mux.js, com versão exata', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies).toHaveProperty('m3u8-parser');
    expect(pkg.devDependencies).toHaveProperty('mux.js');
    expect(pkg.devDependencies).toHaveProperty('mediabunny');
    expect(pkg.dependencies ?? {}).not.toHaveProperty('mediabunny');
    expect(pkg.devDependencies?.['mediabunny']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
