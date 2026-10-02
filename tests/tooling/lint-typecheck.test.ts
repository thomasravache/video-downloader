import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT, run } from './helpers';

const tmp = join(ROOT, 'src', '__tmp_violation__.ts');

afterEach(() => {
  rmSync(tmp, { force: true });
});

describe('lint e typecheck', () => {
  it(
    'SPEC-0002:IT-03 saem ≠ 0 com arquivo violador e 0 sem ele',
    () => {
      // sem o arquivo: limpo
      const cleanTc = run('pnpm', ['typecheck'], 240_000);
      const cleanLint = run('pnpm', ['lint'], 240_000);
      expect(cleanTc.code, cleanTc.out).toBe(0);
      expect(cleanLint.code, cleanLint.out).toBe(0);

      try {
        mkdirSync(join(ROOT, 'src'), { recursive: true });
        writeFileSync(
          tmp,
          'export function f(x) {\n  const y: number = "a";\n  var z: any = x;\n  return y + z;\n}\n',
        );
        const tc = run('pnpm', ['typecheck'], 240_000);
        const lint = run('pnpm', ['lint'], 240_000);
        expect(tc.code, tc.out).not.toBe(0);
        expect(lint.code, lint.out).not.toBe(0);
      } finally {
        rmSync(tmp, { force: true });
      }
    },
    600_000,
  );
});
