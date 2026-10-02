/**
 * Contrato usado (SPEC-0005:IT-04, CT-01). Estes testes compartilham `.wxt/` e o diretório de
 * saída; por isso ficam no MESMO arquivo (execução serial) e fazem builds reais.
 *
 *  - SPEC-0010:IT-04: no mesmo build, permissões exatas (+ webRequest) e política de host da SPEC-0009
 *  - IT-04: `pnpm build` -> .output/chrome-mv3-{public,local}/manifest.json
 *  - SPEC-0009:IT-05 (ADR-0012): no mesmo build, local tem host_permissions http(s) (http + https, qualquer host)
 *    e nenhuma optional_host_permissions; public tem optional_host_permissions iguais e nenhuma
 *    host_permissions; ambos com exatamente as permissões da SPEC-0005
 *  - CT-01: wxt build com PROVIDERS_EXTRA_DIR=tests/fixtures/providers (provider `skeleton-local-only`,
 *    flavors:['local']) e saída em CT_OUT_DIR (tests/integration/support/wxt.contract.config.ts):
 *      * o bundle public não contém 'skeleton-local-only'; o local contém;
 *      * `validateProviderManifest` (src/core/contracts) rejeita flavors vazio/desconhecido.
 *    Cada diretório de PROVIDERS_EXTRA_DIR tem `provider.json` + `index.ts` (default export = Provider),
 *    como src/providers/<id>/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { validateProviderManifest } from '../../src/core/contracts';

const ROOT = resolve(import.meta.dirname, '../..');
const EXTRA_DIR = join(ROOT, 'tests/fixtures/providers');
const MARKER = 'skeleton-local-only';
const MODE = { public: 'public', local: 'flavor-local' } as const;
const flavors = ['public', 'local'] as const;

function sh(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 540_000,
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
}

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function bundleText(dir: string): string {
  return allFiles(dir)
    .filter((f) => /\.(js|mjs|html|json)$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

/** Um único `pnpm build` real por arquivo (os describes compartilham `.output/`). */
let built = false;
function build(): void {
  if (!built) {
    const r = sh('pnpm', ['build']);
    expect(r.code, r.out).toBe(0);
    built = true;
  }
}

describe('manifesto dos builds reais', () => {
  it('SPEC-0005:IT-04 o manifest de public não tem host_permissions e nenhum flavor tem <all_urls> nem CSP customizada', () => {
    build();
    expect(
      readManifest(join(ROOT, '.output', 'chrome-mv3-public'))['host_permissions'],
    ).toBeUndefined();
    for (const flavor of flavors) {
      const dir = join(ROOT, '.output', `chrome-mv3-${flavor}`);
      const manifest = readManifest(dir);
      expect(manifest['content_security_policy'], flavor).toBeUndefined();
      expect(JSON.stringify(manifest), flavor).not.toContain('<all_urls>');
    }
  }, 600_000);

  it('SPEC-0005:IT-04 o manifest de public e local pede só activeTab, scripting, downloads, storage e webRequest', () => {
    build();
    for (const flavor of flavors) {
      const manifest = readManifest(join(ROOT, '.output', `chrome-mv3-${flavor}`));
      expect([...((manifest['permissions'] as string[] | undefined) ?? [])].sort(), flavor).toEqual(
        ['activeTab', 'downloads', 'scripting', 'storage', 'webRequest'],
      );
    }
  }, 600_000);
});

describe('permissões de host por flavor (ADR-0012)', () => {
  const HOST_PATTERNS = ['http://*/*', 'https://*/*'];
  const SPEC_0005_PERMISSIONS = ['activeTab', 'downloads', 'scripting', 'storage', 'webRequest'];
  const manifestOf = (flavor: (typeof flavors)[number]) =>
    readManifest(join(ROOT, '.output', `chrome-mv3-${flavor}`));
  const sorted = (value: unknown) => [...((value as string[] | undefined) ?? [])].sort();

  it('SPEC-0009:IT-05 o manifest local tem host_permissions http(s) e nenhuma optional_host_permissions', () => {
    build();
    const manifest = manifestOf('local');

    expect(sorted(manifest['host_permissions'])).toEqual(HOST_PATTERNS);
    expect(manifest['optional_host_permissions']).toBeUndefined();
  }, 600_000);

  it('SPEC-0009:IT-05 o manifest public tem optional_host_permissions http(s) e nenhuma host_permissions', () => {
    build();
    const manifest = manifestOf('public');

    expect(sorted(manifest['optional_host_permissions'])).toEqual(HOST_PATTERNS);
    expect(manifest['host_permissions']).toBeUndefined();
  }, 600_000);

  it('SPEC-0009:IT-05 os dois flavors mantêm as permissões da SPEC-0005 (mais webRequest da SPEC-0010) e nenhuma outra', () => {
    build();
    for (const flavor of flavors) {
      expect(sorted(manifestOf(flavor)['permissions']), flavor).toEqual(SPEC_0005_PERMISSIONS);
    }
  }, 600_000);
});

describe('permissões da detecção por rede (SPEC-0010)', () => {
  const HOST_PATTERNS = ['http://*/*', 'https://*/*'];
  const manifestOf = (flavor: (typeof flavors)[number]) =>
    readManifest(join(ROOT, '.output', `chrome-mv3-${flavor}`));
  const sorted = (value: unknown) => [...((value as string[] | undefined) ?? [])].sort();

  it('SPEC-0010:IT-04 os dois manifestos têm exatamente activeTab, scripting, downloads, storage e webRequest', () => {
    build();
    for (const flavor of flavors) {
      expect(sorted(manifestOf(flavor)['permissions']), flavor).toEqual([
        'activeTab',
        'downloads',
        'scripting',
        'storage',
        'webRequest',
      ]);
    }
  }, 600_000);

  it('SPEC-0010:IT-04 (guarda: passa antes da mudança) a política de host da SPEC-0009 permanece (local: host_permissions; public: opcionais), sem <all_urls> nem CSP', () => {
    build();
    const local = manifestOf('local');
    const pub = manifestOf('public');

    expect(sorted(local['host_permissions'])).toEqual(HOST_PATTERNS);
    expect(local['optional_host_permissions']).toBeUndefined();
    expect(sorted(pub['optional_host_permissions'])).toEqual(HOST_PATTERNS);
    expect(pub['host_permissions']).toBeUndefined();
    for (const flavor of flavors) {
      const manifest = manifestOf(flavor);
      expect(manifest['content_security_policy'], flavor).toBeUndefined();
      expect(JSON.stringify(manifest), flavor).not.toContain('<all_urls>');
    }
  }, 600_000);
});

describe('contrato ProviderManifest / virtual:providers v1', () => {
  const outDirs: string[] = [];
  afterAll(() => {
    for (const dir of outDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function buildWithExtra(flavor: 'public' | 'local'): string {
    const outBase = mkdtempSync(join(tmpdir(), `vd-ct01-${flavor}-`));
    outDirs.push(outBase);
    const r = sh(
      'pnpm',
      [
        'exec',
        'wxt',
        'build',
        '--mode',
        MODE[flavor],
        '-c',
        'tests/integration/support/wxt.contract.config.ts',
      ],
      { FLAVOR: flavor, PROVIDERS_EXTRA_DIR: EXTRA_DIR, CT_OUT_DIR: outBase },
    );
    expect(r.code, r.out).toBe(0);
    const out = join(outBase, `chrome-mv3-${flavor}`);
    expect(existsSync(join(out, 'manifest.json')), r.out).toBe(true);
    return out;
  }

  it('SPEC-0005:CT-01 o bundle public não contém o provider-fixture flavors:[local] e o local contém', () => {
    const publicText = bundleText(buildWithExtra('public'));
    const localText = bundleText(buildWithExtra('local'));

    expect(publicText).not.toContain(MARKER);
    expect(localText).toContain(MARKER);
    expect(publicText).toContain('generic');
  }, 1_200_000);

  it('SPEC-0005:CT-01 o schema de provider.json aceita flavors válidos', () => {
    expect(validateProviderManifest({ id: 'generic', flavors: ['public', 'local'] })).toEqual({
      ok: true,
      value: { id: 'generic', flavors: ['public', 'local'] },
    });
    expect(validateProviderManifest({ id: 'site', flavors: ['local'] }).ok).toBe(true);
  });

  it('SPEC-0005:CT-01 o schema de provider.json rejeita flavors vazio ou com valor desconhecido', () => {
    expect(validateProviderManifest({ id: 'x', flavors: [] }).ok).toBe(false);
    expect(validateProviderManifest({ id: 'x', flavors: ['beta'] }).ok).toBe(false);
    expect(validateProviderManifest({ id: 'x', flavors: ['public', 'beta'] }).ok).toBe(false);
    expect(validateProviderManifest({ id: 'x' }).ok).toBe(false);
    expect(validateProviderManifest({ flavors: ['public'] }).ok).toBe(false);
    expect(validateProviderManifest(null).ok).toBe(false);
  });
});
