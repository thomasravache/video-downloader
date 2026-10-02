import { describe, expect, it } from 'vitest';
import { buildManifest, resolveFlavor } from '../../wxt.config';

describe('flavor e manifesto', () => {
  it.each(['public', 'local'] as const)(
    'SPEC-0002:UT-01 modo %s resolve o FLAVOR e gera manifesto MV3 com default_locale pt_BR',
    (mode) => {
      const flavor = resolveFlavor(mode);
      expect(flavor).toBe(mode);
      const manifest = buildManifest(flavor);
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.default_locale).toBe('pt_BR');
      expect(manifest.name).toBe('__MSG_extName__');
    },
  );

  it.each(['foo', '', 'production', 'Public'])(
    'SPEC-0002:UT-02 modo inválido "%s" lança "FLAVOR inválido"',
    (mode) => {
      expect(() => resolveFlavor(mode)).toThrowError(/FLAVOR inválido/);
    },
  );
});
