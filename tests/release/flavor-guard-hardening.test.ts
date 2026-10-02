/**
 * SPEC-0006:IT-01 e SPEC-0006:CT-01 — endurecimento do `flavor-guard` (Emenda 2).
 *
 * Contrato (para o Implementer):
 *  (c) subdiretório de `providersDir` SEM `provider.json` → Error `INVALID_PROVIDER_MANIFEST` citando o diretório.
 *  (d) `providersDir` existente que resulta em zero manifestos → Error `NO_PROVIDERS_FOUND`; o CLI sai != 0.
 *  (e) o id só vaza quando é token inteiro (sem [A-Za-z0-9_-] colados); `id` do manifesto: `^[a-z][a-z0-9-]{2,}$`
 *      (violação → `INVALID_PROVIDER_MANIFEST`).
 *  (f) dist public com qualquer `*.map` → `FORBIDDEN_PROVIDER_IN_PUBLIC` (a mensagem cita o .map);
 *      dist com `src/providers/<dir>` de provider sem `public` → `FORBIDDEN_PROVIDER_IN_PUBLIC:<id>`;
 *      `src/providers/<dir>` de provider público passa.
 */
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFlavorGuard } from '../../scripts/release/flavor-guard.ts';
import { runNode, tmp, writeTree } from './helpers';

function manifest(id: string, flavors: string[]): string {
  return JSON.stringify({ id, flavors });
}

function dist(files: Record<string, string>): string {
  const dir = join(tmp('dist-'), 'chrome-mv3-public');
  writeTree(dir, {
    'manifest.json': '{"manifest_version":3,"name":"x"}',
    'background.js': 'var a="generic";',
    ...files,
  });
  return dir;
}

function localOnly(id: string, dirName = 'lo'): string {
  const providers = tmp('providers-');
  writeTree(providers, {
    'generic/provider.json': manifest('generic', ['public', 'local']),
    [`${dirName}/provider.json`]: manifest(id, ['local']),
  });
  return providers;
}

describe('SPEC-0006:IT-01 flavor-guard falha fechado (Emenda 2 c, d)', () => {
  it('SPEC-0006:IT-01 (c) subdiretório sem provider.json → INVALID_PROVIDER_MANIFEST citando o diretório', () => {
    const providers = tmp('providers-');
    writeTree(providers, {
      'generic/provider.json': manifest('generic', ['public', 'local']),
      'orphan-dir/index.ts': 'export {};',
    });
    let message = '';
    try {
      checkFlavorGuard({ distDir: dist({}), providersDir: providers });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('INVALID_PROVIDER_MANIFEST');
    expect(message).toContain('orphan-dir');
  });

  it('SPEC-0006:IT-01 (d) providersDir existente sem nenhum manifesto → NO_PROVIDERS_FOUND', () => {
    const empty = tmp('providers-');
    expect(() => {
      checkFlavorGuard({ distDir: dist({}), providersDir: empty });
    }).toThrow(/NO_PROVIDERS_FOUND/);
  });

  it('SPEC-0006:IT-01 (d) CLI: diretório configurado (PROVIDERS_EXTRA_DIR) sem manifestos → exit != 0', () => {
    const r = runNode(['scripts/release/cli.ts', 'flavor-guard', dist({})], {
      PROVIDERS_EXTRA_DIR: tmp('extra-empty-'),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('NO_PROVIDERS_FOUND');
  });
});

describe('SPEC-0006:IT-01 id casado como token inteiro (Emenda 2 e)', () => {
  const check = (content: string) => () => {
    checkFlavorGuard({
      distDir: dist({ 'chunks/x.js': content }),
      providersDir: localOnly('abc-local'),
    });
  };

  it.each([
    'var a="xabc-localy";',
    'var a="abc-local2";',
    'var a="abc-local-extra";',
    'abc_local_x',
  ])('SPEC-0006:IT-01 sem falso positivo: %s', (content) => {
    expect(check(content)).not.toThrow();
  });

  it.each([
    '{"id":"abc-local"}',
    "var a='abc-local';",
    'see abc-local here',
    'x(abc-local);',
    'abc-local',
    'a,abc-local,b',
    'line\nabc-local\n',
  ])('SPEC-0006:IT-01 acusa o id como token: %j', (content) => {
    expect(check(content)).toThrow('FORBIDDEN_PROVIDER_IN_PUBLIC:abc-local');
  });
});

describe('SPEC-0006:CT-01 formato do id do manifesto (Emenda 2 e)', () => {
  const guardWithId = (id: string) => () => {
    const providers = tmp('providers-');
    writeTree(providers, { 'p/provider.json': manifest(id, ['public']) });
    checkFlavorGuard({ distDir: dist({}), providersDir: providers });
  };

  it.each(['ok', 'X', 'a b', 'Abc', '1abc', 'ab_c'])(
    'SPEC-0006:CT-01 rejeita id fora de ^[a-z][a-z0-9-]{2,}$: %j',
    (id) => {
      expect(guardWithId(id)).toThrow(/INVALID_PROVIDER_MANIFEST/);
    },
  );

  it.each(['abc', 'release-local-only', 'a1-b2'])('SPEC-0006:CT-01 aceita id válido: %j', (id) => {
    expect(guardWithId(id)).not.toThrow();
  });
});

describe('SPEC-0006:IT-01 bundle public com .map e caminhos de provider (Emenda 2 f)', () => {
  it('SPEC-0006:IT-01 (f) qualquer *.map no dist public → FORBIDDEN_PROVIDER_IN_PUBLIC', () => {
    const d = dist({ 'chunks/popup.js.map': '{"version":3,"sources":[]}' });
    let message = '';
    try {
      checkFlavorGuard({ distDir: d, providersDir: localOnly('abc-local') });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('FORBIDDEN_PROVIDER_IN_PUBLIC');
    expect(message).toContain('popup.js.map');
  });

  it('SPEC-0006:IT-01 (f) caminho src/providers/<dir> de provider sem public → FORBIDDEN_PROVIDER_IN_PUBLIC:<id>', () => {
    const providers = localOnly('abc-local', 'lo-dir');
    const d = dist({ 'chunks/x.js': '// from src/providers/lo-dir/index.ts\n' });
    expect(basename(join(providers, 'lo-dir'))).toBe('lo-dir');
    expect(() => {
      checkFlavorGuard({ distDir: d, providersDir: providers });
    }).toThrow('FORBIDDEN_PROVIDER_IN_PUBLIC:abc-local');
  });

  it('SPEC-0006:IT-01 (f) caminho src/providers/generic (provider público) passa', () => {
    const d = dist({ 'chunks/x.js': '// from src/providers/generic/index.ts\n' });
    expect(() => {
      checkFlavorGuard({ distDir: d, providersDir: localOnly('abc-local', 'lo-dir') });
    }).not.toThrow();
  });
});
