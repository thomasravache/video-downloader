import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT, run } from '../tooling/helpers';

/**
 * Contrato de nomes de regra em .dependency-cruiser.cjs (a saída de `pnpm arch` deve citar o nome):
 *   no-core-to-providers, no-provider-to-provider, no-popup-to-providers,
 *   no-core-browser-api, no-circular
 */
const TMP = '__arch_tmp__';
const created: string[] = [];

function write(rel: string, content: string): void {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  created.push(rel);
}

const provider = (site: string, body = 'export const id = 1;\n'): void => {
  write(`src/providers/${TMP}-${site}/index.ts`, body);
};

afterEach(() => {
  for (const rel of created.splice(0)) {
    rmSync(join(ROOT, rel), { force: true });
  }
  for (const dir of [
    `src/providers/${TMP}-a`,
    `src/providers/${TMP}-b`,
    `src/core/${TMP}`,
    `entrypoints/popup/${TMP}`,
  ]) {
    rmSync(join(ROOT, dir), { recursive: true, force: true });
  }
});

function arch() {
  return run('pnpm', ['arch'], 180_000);
}

describe('pnpm arch (regras do ADR-0001 / ADR-0011)', () => {
  it('SPEC-0003:IT-04 na árvore limpa, pnpm arch sai com 0', () => {
    const r = arch();
    expect(r.code, r.out).toBe(0);
  });

  it('SPEC-0003:IT-04 core importando providers falha citando no-core-to-providers', () => {
    provider('a');
    write(
      `src/core/${TMP}/bad.ts`,
      `import { id } from '../../providers/${TMP}-a/index';\nexport const x = id;\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-core-to-providers');
  });

  it('SPEC-0003:IT-04 provider importando outro provider falha citando no-provider-to-provider', () => {
    provider('b');
    provider('a', `import { id } from '../${TMP}-b/index';\nexport const x = id;\n`);
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-provider-to-provider');
  });

  it('SPEC-0003:IT-04 popup importando providers falha citando no-popup-to-providers', () => {
    provider('a');
    write(
      `entrypoints/popup/${TMP}/bad.ts`,
      `import { id } from '../../../src/providers/${TMP}-a/index';\nexport const x = id;\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-popup-to-providers');
  });

  it('SPEC-0003:IT-04 core usando a API de browser (chrome/browser) falha citando no-core-browser-api', () => {
    write(
      `src/core/${TMP}/bad.ts`,
      `import { browser } from 'wxt/browser';\nexport const id = browser.runtime.id;\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-core-browser-api');
  });

  it('SPEC-0003:IT-04 ciclo de imports entre dois módulos falha citando no-circular', () => {
    write(
      `src/core/${TMP}/a.ts`,
      `import { b } from './b';\nexport const a: number = 1 + (b ? 0 : 1);\n`,
    );
    write(
      `src/core/${TMP}/b.ts`,
      `import { a } from './a';\nexport const b: number = 1 + (a ? 0 : 1);\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-circular');
  });
});
