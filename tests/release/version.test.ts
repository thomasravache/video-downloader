/**
 * SPEC-0006:UT-01 — verificação de versão da tag (job `verify-version`).
 *
 * CONTRATO para o Implementer (scripts/release/):
 *  - version.ts : `verifyVersion(tag, pkgVersion): { version, prerelease }` — tag `vX.Y.Z[-rc.N]`;
 *                 igual a `v${pkgVersion}` retorna; QUALQUER outro caso (divergente, sem "v", formato
 *                 inválido, rc vs estável) lança Error cuja mensagem contém `VERSION_MISMATCH`.
 *                 `isPrerelease(tagOrVersion)`: true só para sufixo `-rc.N`.
 *  - cli.ts     : `node scripts/release/cli.ts verify-version <tag>` lê ./package.json#version;
 *                 exit 0 se coerente, exit != 0 com `VERSION_MISMATCH` na saída caso contrário.
 *  - redact.ts  : `redact(text, secrets[])`, `formatError(error, secrets[])` (UT-03).
 *  - webstore.ts: `publishTargetFor(version)`, `upload`, `publish`, `releaseToStore` (UT-02).
 *  - flavor-guard.ts: `checkFlavorGuard({ distDir, providersDir })` síncrono (IT-01, CT-01);
 *                 cli.ts `flavor-guard <distDir>` usa `src/providers` (se existir) + `PROVIDERS_EXTRA_DIR`.
 *  - cli.ts `webstore <zip> <tag>` lê CWS_CLIENT_ID/CWS_CLIENT_SECRET/CWS_REFRESH_TOKEN/CWS_EXTENSION_ID.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPrerelease, verifyVersion } from '../../scripts/release/version.ts';
import { ROOT, runNode } from './helpers';

describe('SPEC-0006:UT-01 verifyVersion', () => {
  it.each([
    ['v0.1.0', '0.1.0', false],
    ['v1.22.333', '1.22.333', false],
    ['v0.1.0-rc.1', '0.1.0-rc.1', true],
    ['v2.0.0-rc.12', '2.0.0-rc.12', true],
  ])('SPEC-0006:UT-01 aceita %s == %s', (tag, pkg, prerelease) => {
    const info = verifyVersion(tag, pkg);
    expect(info.version).toBe(pkg);
    expect(info.prerelease).toBe(prerelease);
  });

  it.each([
    ['v0.1.1', '0.1.0'],
    ['v0.1.0', '0.1.1'],
    ['v0.1.0-rc.1', '0.1.0'],
    ['v0.1.0', '0.1.0-rc.1'],
    ['v0.1.0-rc.1', '0.1.0-rc.2'],
    ['0.1.0', '0.1.0'],
    ['vfoo', '0.1.0'],
    ['', '0.1.0'],
  ])('SPEC-0006:UT-01 rejeita tag %j contra package %j com VERSION_MISMATCH', (tag, pkg) => {
    expect(() => verifyVersion(tag, pkg)).toThrow(/VERSION_MISMATCH/);
  });

  it('SPEC-0006:UT-01 isPrerelease detecta apenas -rc.N', () => {
    expect(isPrerelease('v0.1.0-rc.1')).toBe(true);
    expect(isPrerelease('0.1.0-rc.3')).toBe(true);
    expect(isPrerelease('v0.1.0')).toBe(false);
    expect(isPrerelease('0.1.0')).toBe(false);
  });
});

describe('SPEC-0006:UT-01 CLI verify-version', () => {
  const pkgVersion = (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;

  it('SPEC-0006:UT-01 sai 0 quando a tag bate com package.json', () => {
    const r = runNode(['scripts/release/cli.ts', 'verify-version', `v${pkgVersion}`]);
    expect(r.code).toBe(0);
  });

  it('SPEC-0006:UT-01 sai != 0 com VERSION_MISMATCH quando diverge', () => {
    const r = runNode(['scripts/release/cli.ts', 'verify-version', 'v999.0.0']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('VERSION_MISMATCH');
  });
});
