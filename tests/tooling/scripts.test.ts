import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers';

const contractScripts = [
  'dev',
  'build',
  'build:public',
  'build:local',
  'lint',
  'format:check',
  'typecheck',
  'test',
  'test:integration',
  'test:e2e',
  'arch',
] as const;

const formerStubs = ['test', 'test:integration', 'test:e2e', 'arch'] as const;

describe('package.json scripts', () => {
  it('SPEC-0002:UT-03 existem todos os scripts do Contrato', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, unknown>;
    };

    for (const name of contractScripts) {
      const value = pkg.scripts[name];
      expect(typeof value, `script "${name}" deve ser string`).toBe('string');
      expect((value as string).trim(), `script "${name}" não pode ser vazio`).not.toBe('');
    }

    for (const name of formerStubs) {
      expect(pkg.scripts[name], `script "${name}" não pode ser stub`).not.toContain(
        'definido em SPEC-0003',
      );
    }
  });
});
