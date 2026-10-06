/**
 * SPEC-0017:IT-09 — Flavor-guard garante ausência do marcador VD_AES128_LOCAL_ONLY no build public.
 */
import { describe, expect, it } from 'vitest';
import { checkFlavorGuard } from '../../scripts/release/flavor-guard';
import { tmp, writeTree } from '../release/helpers';

const MARKER = 'VD_AES128_LOCAL_ONLY';

function dist(files: Record<string, string>): string {
  const dir = tmp('dist-public-');
  writeTree(dir, {
    'manifest.json': '{"manifest_version":3,"name":"VD"}',
    'background.js': 'console.log("public");',
    ...files,
  });
  return dir;
}

function dummyProviders(): string {
  const dir = tmp('providers-');
  writeTree(dir, {
    'generic/provider.json': JSON.stringify({ id: 'generic', flavors: ['public', 'local'] }),
  });
  return dir;
}

describe('SPEC-0017:IT-09 flavor-guard para AES-128', () => {
  it('SPEC-0017:IT-09 flavor-guard falha com FORBIDDEN_AES128_IN_PUBLIC se o marcador vazar para o bundle public', () => {
    const leakyDist = dist({
      'chunks/aes.js': `const tag = "${MARKER}";\nexport default tag;`,
    });

    expect(() => {
      checkFlavorGuard({ distDir: leakyDist, providersDir: dummyProviders() });
    }).toThrow(/FORBIDDEN_AES128_IN_PUBLIC/);
  });

  it('SPEC-0017:IT-09 sem o marcador no bundle public, flavor-guard passa normalmente', () => {
    const cleanDist = dist({
      'chunks/clean.js': 'console.log("clean bundle");',
    });

    expect(() => {
      checkFlavorGuard({ distDir: cleanDist, providersDir: dummyProviders() });
    }).not.toThrow();
  });
});
