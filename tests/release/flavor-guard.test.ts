/**
 * SPEC-0006:IT-01 e SPEC-0006:CT-01 — `flavor-guard` (scripts/release/flavor-guard.ts).
 *
 * Contrato: `checkFlavorGuard({ distDir, providersDir })` (síncrono; `providersDir` é string ou lista).
 *  - Cada SUBDIRETÓRIO de `providersDir` com `provider.json` é um provider (mesma forma de `src/providers`
 *    e de `PROVIDERS_EXTRA_DIR`, SPEC-0005@1). Subdiretório sem `provider.json` falha fechado (Emenda 2).
 *  - Varre TODOS os arquivos de `distDir` (recursivo); se algum contém o `id` (texto) de um provider cujo
 *    `flavors` não inclui 'public' → lança Error com `FORBIDDEN_PROVIDER_IN_PUBLIC:<id>`.
 *  - `provider.json` inválido (JSON ruim, sem `id`, `id` vazio/não-string, `flavors` ausente/não-array/vazio,
 *    com valor fora de {public, local}) → Error com `INVALID_PROVIDER_MANIFEST` e o caminho do arquivo.
 *  - `distDir` inexistente → Error com `DIST_NOT_FOUND`.
 *  - CLI: `node scripts/release/cli.ts flavor-guard <distDir>` usa `src/providers` (ignorado se não existir)
 *    mais `PROVIDERS_EXTRA_DIR` (se definido); exit 0 se limpo; exit != 0 com a mensagem do guard.
 *
 * IT-01 caso (b) — build real: pulado enquanto `src/providers/build` não existe (o plugin de registro chega
 * com SPEC-0005). O Arquiteto o executa após a integração das ondas (G5). Como o registro de SPEC-0005
 * (CT-01 dela) exclui o fixture `local` do bundle public, o caso prova (1) build limpo passa no guard e
 * (2) o guard acusa o id quando ele vaza para o bundle (simulado acrescentando o id ao JS construído).
 */
import { cpSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFlavorGuard } from '../../scripts/release/flavor-guard.ts';
import { ROOT, run, runNode, tmp, writeTree } from './helpers';

const FIXTURE = join(ROOT, 'tests/fixtures/providers/release-local-only');
const FIXTURE_ID = 'release-local-only';

function manifest(id: string, flavors: string[]): string {
  return JSON.stringify({ id, flavors });
}

/** providersDir com o fixture local-only e um provider público/ambos. */
function providersWithFixture(): string {
  const dir = tmp('providers-');
  cpSync(FIXTURE, join(dir, FIXTURE_ID), { recursive: true });
  writeTree(dir, {
    'generic/provider.json': manifest('generic', ['public', 'local']),
    'only-public/provider.json': manifest('only-public-x', ['public']),
  });
  return dir;
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

describe('SPEC-0006:IT-01 flavor-guard sobre um dist public fabricado', () => {
  it('SPEC-0006:IT-01 bundle com id de provider local → FORBIDDEN_PROVIDER_IN_PUBLIC:<id>', () => {
    const d = dist({ 'chunks/popup-abc123.js': `var p={id:"${FIXTURE_ID}",flavors:["local"]};` });
    expect(() => {
      checkFlavorGuard({ distDir: d, providersDir: providersWithFixture() });
    }).toThrow(`FORBIDDEN_PROVIDER_IN_PUBLIC:${FIXTURE_ID}`);
  });

  it('SPEC-0006:IT-01 sem o fixture no bundle, o guard passa (providers public/ambos são permitidos)', () => {
    const d = dist({ 'chunks/popup.js': 'var p=["generic","only-public-x"];' });
    expect(() => {
      checkFlavorGuard({ distDir: d, providersDir: providersWithFixture() });
    }).not.toThrow();
  });

  it('SPEC-0006:IT-01 sem o fixture nos providers, o mesmo bundle passa', () => {
    const d = dist({ 'chunks/popup.js': `var p="${FIXTURE_ID}";` });
    const only = tmp('providers-');
    writeTree(only, { 'generic/provider.json': manifest('generic', ['public', 'local']) });
    expect(() => {
      checkFlavorGuard({ distDir: d, providersDir: only });
    }).not.toThrow();
  });

  it('SPEC-0006:IT-01 aceita lista de providersDir (src/providers + extra)', () => {
    const base = tmp('base-');
    writeTree(base, { 'generic/provider.json': manifest('generic', ['public', 'local']) });
    const d = dist({ 'a/b/c.js': `x("${FIXTURE_ID}")` });
    expect(() => {
      checkFlavorGuard({ distDir: d, providersDir: [base, providersWithFixture()] });
    }).toThrow(`FORBIDDEN_PROVIDER_IN_PUBLIC:${FIXTURE_ID}`);
  });

  it('SPEC-0006:IT-01 distDir inexistente → DIST_NOT_FOUND', () => {
    expect(() => {
      checkFlavorGuard({ distDir: join(tmp(), 'nope'), providersDir: providersWithFixture() });
    }).toThrow(/DIST_NOT_FOUND/);
  });

  it('SPEC-0006:IT-01 CLI: PROVIDERS_EXTRA_DIR faz o guard acusar o id; sem ele passa', () => {
    const d = dist({ 'chunks/x.js': `var id="${FIXTURE_ID}";` });
    const extra = providersWithFixture();
    const bad = runNode(['scripts/release/cli.ts', 'flavor-guard', d], {
      PROVIDERS_EXTRA_DIR: extra,
    });
    expect(bad.code).not.toBe(0);
    expect(bad.out).toContain(`FORBIDDEN_PROVIDER_IN_PUBLIC:${FIXTURE_ID}`);

    const ok = runNode(['scripts/release/cli.ts', 'flavor-guard', d], { PROVIDERS_EXTRA_DIR: '' });
    expect(ok.code).toBe(0);
  });
});

describe('SPEC-0006:IT-01 flavor-guard com build real (precisa do registro de SPEC-0005)', () => {
  it.skipIf(!existsSync(join(ROOT, 'src/providers/build')))(
    'SPEC-0006:IT-01 pnpm build:public + PROVIDERS_EXTRA_DIR: limpo passa; id vazado é acusado',
    () => {
      const extra = tmp('extra-providers-');
      cpSync(FIXTURE, join(extra, FIXTURE_ID), { recursive: true });
      const built = join(ROOT, '.output/chrome-mv3-public');

      const build = run('pnpm', ['build:public'], { PROVIDERS_EXTRA_DIR: extra }, 600_000);
      expect(build.code, build.out).toBe(0);

      const clean = runNode(['scripts/release/cli.ts', 'flavor-guard', built], {
        PROVIDERS_EXTRA_DIR: extra,
      });
      expect(clean.code, clean.out).toBe(0);

      const js = readdirSync(built, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.js') && statSync(join(built, f)).isFile())
        .map((f) => join(built, f));
      expect(js.length).toBeGreaterThan(0);
      appendFileSync(js[0] as string, `\n;globalThis.__leak="${FIXTURE_ID}";\n`);

      const leaked = runNode(['scripts/release/cli.ts', 'flavor-guard', built], {
        PROVIDERS_EXTRA_DIR: extra,
      });
      expect(leaked.code).not.toBe(0);
      expect(leaked.out).toContain(`FORBIDDEN_PROVIDER_IN_PUBLIC:${FIXTURE_ID}`);
    },
    900_000,
  );
});

describe('SPEC-0006:CT-01 schema de provider.json (SPEC-0005@1) lido pelo guard', () => {
  function guardWith(manifestJson: string) {
    const providers = tmp('providers-');
    writeTree(providers, { 'p/provider.json': manifestJson });
    return () => {
      checkFlavorGuard({ distDir: dist({}), providersDir: providers });
    };
  }

  it.each([
    ['public', ['public']],
    ['local', ['local']],
    ['ambos', ['public', 'local']],
  ])('SPEC-0006:CT-01 aceita flavors válidos (%s)', (_n, flavors) => {
    expect(guardWith(manifest('p-id', flavors))).not.toThrow();
  });

  it('SPEC-0006:CT-01 provider só-local declarado pelo schema é tratado como proibido no public', () => {
    const providers = tmp('providers-');
    writeTree(providers, { 'p/provider.json': manifest('leaky-id', ['local']) });
    const d = dist({ 'x.js': 'var a="leaky-id"' });
    expect(() => {
      checkFlavorGuard({ distDir: d, providersDir: providers });
    }).toThrow('FORBIDDEN_PROVIDER_IN_PUBLIC:leaky-id');
  });

  it.each([
    ['flavors vazio', manifest('p-id', [])],
    ['flavor desconhecido', manifest('p-id', ['beta'])],
    ['flavor desconhecido misturado', manifest('p-id', ['public', 'beta'])],
    ['sem id', JSON.stringify({ flavors: ['public'] })],
    ['id vazio', manifest('', ['public'])],
    ['id não-string', JSON.stringify({ id: 7, flavors: ['public'] })],
    ['campo renomeado (flavor)', JSON.stringify({ id: 'p-id', flavor: ['public'] })],
    ['sem flavors', JSON.stringify({ id: 'p-id' })],
    ['flavors não-array', JSON.stringify({ id: 'p-id', flavors: 'public' })],
    ['JSON inválido', '{ not json'],
  ])('SPEC-0006:CT-01 rejeita manifesto inválido: %s', (_n, json) => {
    expect(guardWith(json)).toThrow(/INVALID_PROVIDER_MANIFEST/);
  });

  it('SPEC-0006:CT-01 PROVIDERS_EXTRA_DIR tem a mesma forma de src/providers (CLI valida os manifestos)', () => {
    const extra = tmp('extra-');
    writeTree(extra, { 'bad/provider.json': manifest('bad', []) });
    const r = runNode(['scripts/release/cli.ts', 'flavor-guard', dist({})], {
      PROVIDERS_EXTRA_DIR: extra,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('INVALID_PROVIDER_MANIFEST');
  });
});
