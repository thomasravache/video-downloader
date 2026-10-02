/**
 * Contrato usado (SPEC-0005:UT-05):
 *   src/providers/build/generate.ts -> generateRegistrySource(entries, flavor): string
 *     entries: ProviderManifest & { modulePath } (src/core/contracts ProviderManifest)
 *     O código gerado referencia o modulePath de cada provider incluído, em ordem, com
 *     o provider `generic` por último; providers fora do flavor não aparecem (nem id nem caminho).
 */
import { describe, expect, it } from 'vitest';
import { generateRegistrySource } from '../../src/providers/build/generate';

const entries = [
  {
    id: 'generic',
    flavors: ['public', 'local'] as ('public' | 'local')[],
    modulePath: '/src/providers/generic/index.ts',
  },
  {
    id: 'site-local',
    flavors: ['local'] as ('public' | 'local')[],
    modulePath: '/src/providers/site-local/index.ts',
  },
  {
    id: 'site-public',
    flavors: ['public'] as ('public' | 'local')[],
    modulePath: '/src/providers/site-public/index.ts',
  },
];

describe('generateRegistrySource', () => {
  it('SPEC-0005:UT-05 flavor public inclui só os providers com public, com generic por último', () => {
    const source = generateRegistrySource(entries, 'public');

    expect(source).toContain('/src/providers/site-public/index.ts');
    expect(source).toContain('/src/providers/generic/index.ts');
    expect(source).not.toContain('site-local');
    expect(source.indexOf('/src/providers/site-public/index.ts')).toBeLessThan(
      source.indexOf('/src/providers/generic/index.ts'),
    );
  });

  it('SPEC-0005:UT-05 flavor local inclui todos, com generic por último', () => {
    const source = generateRegistrySource(entries, 'local');
    const generic = source.lastIndexOf('/src/providers/generic/index.ts');

    expect(source).toContain('/src/providers/site-local/index.ts');
    expect(source).toContain('/src/providers/site-public/index.ts');
    expect(source.indexOf('/src/providers/site-local/index.ts')).toBeLessThan(generic);
    expect(source.indexOf('/src/providers/site-public/index.ts')).toBeLessThan(generic);
  });

  it('SPEC-0005:UT-05 o módulo gerado exporta providers', () => {
    expect(generateRegistrySource(entries, 'public')).toMatch(/export\s+(const|\{)[^;]*providers/);
  });
});
