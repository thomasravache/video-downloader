/**
 * SPEC-0006:IT-01 — diretório reservado `build` em `src/providers/` (Emenda 4, integração).
 * `src/providers/build/` é código do plugin Vite (SPEC-0005), não um provider: o guard o ignora.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFlavorGuard } from '../../scripts/release/flavor-guard.ts';
import { tmp, writeTree } from './helpers';

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

describe('SPEC-0006:IT-01 diretório reservado `build` (Emenda 4)', () => {
  it('SPEC-0006:IT-01 build/ sem provider.json é ignorado (não lança INVALID_PROVIDER_MANIFEST)', () => {
    const providers = tmp('providers-');
    writeTree(providers, {
      'generic/provider.json': manifest('generic', ['public', 'local']),
      'build/plugin.ts': 'export {};',
    });
    expect(() => {
      checkFlavorGuard({ distDir: dist({}), providersDir: providers });
    }).not.toThrow();
  });

  it('SPEC-0006:IT-01 com build/ ignorado, um id local proibido ainda é detectado', () => {
    const providers = tmp('providers-');
    writeTree(providers, {
      'generic/provider.json': manifest('generic', ['public', 'local']),
      'build/plugin.ts': 'export {};',
      'lo/provider.json': manifest('abc-local', ['local']),
    });
    expect(() => {
      checkFlavorGuard({
        distDir: dist({ 'chunks/x.js': 'var s="abc-local";' }),
        providersDir: providers,
      });
    }).toThrow(/FORBIDDEN_PROVIDER_IN_PUBLIC/);
  });

  it('SPEC-0006:IT-01 diretório chamado build COM provider.json continua ignorado (nome reservado vence)', () => {
    const providers = tmp('providers-');
    writeTree(providers, {
      'generic/provider.json': manifest('generic', ['public', 'local']),
      'build/provider.json': manifest('abc-local', ['local']),
    });
    // o id de build/ não é registrado como proibido: aparecer no dist não deve ser detectado
    expect(() => {
      checkFlavorGuard({
        distDir: dist({ 'chunks/x.js': 'var s="abc-local";' }),
        providersDir: providers,
      });
    }).not.toThrow();
  });
});
