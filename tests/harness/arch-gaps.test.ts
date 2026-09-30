import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT, run } from '../tooling/helpers';

/**
 * Lacunas de cobertura de arquitetura achadas na revisão G4 (SPEC-0003 IT-04).
 * Regras em .dependency-cruiser.cjs: no-core-to-entrypoints, no-provider-to-ui,
 * no-core-browser-api, not-to-unresolvable. Globais do core: ESLint no-restricted-globals.
 */
const TMP = '__arch_tmp__';
const created: string[] = [];

function write(rel: string, content: string): void {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  created.push(rel);
}

afterEach(() => {
  for (const rel of created.splice(0)) {
    rmSync(join(ROOT, rel), { force: true });
  }
  for (const dir of [`src/${TMP}`, `src/core/${TMP}`, `src/providers/${TMP}-a`]) {
    rmSync(join(ROOT, dir), { recursive: true, force: true });
  }
});

const arch = () => run('pnpm', ['arch'], 180_000);
const lint = () => run('pnpm', ['lint'], 240_000);

describe('pnpm arch / pnpm lint (lacunas da revisão G4)', () => {
  it('SPEC-0003:IT-04 core importando entrypoints falha citando no-core-to-entrypoints', () => {
    write(
      `src/core/${TMP}/bad.ts`,
      `import { x } from '../../../entrypoints/popup/main';\nexport const y = x;\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-core-to-entrypoints');
  });

  it('SPEC-0003:IT-04 provider importando entrypoints/popup falha citando no-provider-to-ui', () => {
    write(
      `src/providers/${TMP}-a/index.ts`,
      `import { x } from '../../../entrypoints/popup/main';\nexport const y = x;\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-provider-to-ui');
  });

  it("SPEC-0003:IT-04 core importando '#imports' falha citando no-core-browser-api", () => {
    write(
      `src/core/${TMP}/bad.ts`,
      `import { browser } from '#imports';\nexport const id = browser.runtime.id;\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-core-browser-api');
  });

  it("SPEC-0003:IT-04 core importando '@wxt-dev/browser' falha citando no-core-browser-api", () => {
    write(
      `src/core/${TMP}/bad.ts`,
      `import { browser } from '@wxt-dev/browser';\nexport const id = browser.runtime.id;\n`,
    );
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('no-core-browser-api');
  });

  it('SPEC-0003:IT-04 import não resolvido falha citando not-to-unresolvable', () => {
    write(`src/${TMP}/bad.ts`, `import { x } from './does-not-exist-xyz';\nexport const y = x;\n`);
    const r = arch();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('not-to-unresolvable');
  });

  it.each(['chrome', 'browser'])(
    'SPEC-0003:IT-04 core usando o global %s falha no pnpm lint por no-restricted-globals',
    (g) => {
      write(`src/core/${TMP}/globals.ts`, `export const id = ${g}.runtime.id;\n`);
      const r = lint();
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain('no-restricted-globals');
    },
  );
});
