/**
 * Contrato usado (SPEC-0014:UT-06, UT-07; ADR-0014 regras 2 e 6; MPL-2.0 da mediabunny, Apache-2.0 de mux.js e
 * m3u8-parser) — build REAL dos dois flavors (`pnpm build`):
 *  - `public/THIRD_PARTY_NOTICES.txt` vai à RAIZ de .output/chrome-mv3-{public,local} e, portanto, à raiz dos zips
 *    (empacotados como no CI: `cd .output/chrome-mv3-<flavor> && zip -qr ../x.zip .`); cita mediabunny (MPL-2.0),
 *    mux.js e m3u8-parser (Apache-2.0) com as versões do package.json;
 *  - o chunk do offscreen (e o que ele importa, inclusive por `import()` dinâmico: a mediabunny só carrega
 *    sob demanda) preserva os comentários de licença/copyright da mediabunny (o minificador não pode removê-los);
 *    popup e background não carregam a biblioteca;
 *  - `mediabunny` no package.json com versão EXATA (sem ^ ou ~), ADR-0008.
 * Premissa a conferir pelo Implementer: o cabeçalho da mediabunny é `/*! Copyright (c) ... Vanilagy ... Mozilla Public
 * License, v. 2.0 ... *\/`; os padrões abaixo aceitam qualquer quebra de linha/asterisco entre as palavras.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT, run } from '../tooling/helpers';

const flavors = ['public', 'local'] as const;
const out = (flavor: string): string => join(ROOT, '.output', `chrome-mv3-${flavor}`);
const NOTICES = 'THIRD_PARTY_NOTICES.txt';
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const declared = (name: string): string | undefined =>
  pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];

let built = false;
function build(): void {
  if (!built) {
    const r = run('pnpm', ['build'], 540_000);
    expect(r.code, r.out).toBe(0);
    built = true;
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'vd-notices-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Um pedaço de texto legal com quebras de linha e asteriscos de comentário no meio normalizados. */
const flat = (text: string): string => text.replace(/[\s*]+/g, ' ');

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return jsFiles(path);
    }
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

/** Arquivos alcançáveis de `entry` por `import`/`import()` relativos (fecho transitivo). */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/["'](\.{1,2}\/[^"'\s]+\.js)["']/g)) {
      queue.push(resolve(dirname(file), match[1] as string));
    }
  }
  return seen;
}

describe('avisos de terceiros no pacote (MPL-2.0 / Apache-2.0)', () => {
  it('SPEC-0014:UT-06 THIRD_PARTY_NOTICES.txt está na raiz dos dois builds e dos dois zips', () => {
    build();
    for (const flavor of flavors) {
      expect(existsSync(join(out(flavor), NOTICES)), `${flavor}: ${NOTICES} na raiz do build`).toBe(
        true,
      );
      const zip = join(tmp, `extension-${flavor}.zip`);
      const packed = spawnSync('zip', ['-qr', zip, '.'], { cwd: out(flavor), encoding: 'utf8' });
      expect(packed.status, packed.stderr).toBe(0);
      const listing = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
      expect(listing.status, listing.stderr).toBe(0);
      const names = listing.stdout.split('\n');
      expect(names, `${flavor}: raiz do zip`).toContain(NOTICES);
      expect(names).toContain('manifest.json');
    }
  }, 600_000);

  it('SPEC-0014:UT-06 o texto cita mediabunny (MPL-2.0), mux.js e m3u8-parser (Apache-2.0) com as versões do package.json', () => {
    build();
    for (const flavor of flavors) {
      const file = join(out(flavor), NOTICES);
      expect(existsSync(file), `${flavor}: ${NOTICES}`).toBe(true);
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      const normalized = flat(text);
      for (const name of ['mediabunny', 'mux.js', 'm3u8-parser']) {
        expect(text, `${flavor}: ${name}`).toContain(name);
        const version = declared(name);
        expect(version, `${name} no package.json`).toBeDefined();
        expect(text, `${flavor}: versão de ${name} (${String(version)})`).toContain(
          String(version),
        );
      }
      expect(normalized, flavor).toMatch(/MPL-2\.0|Mozilla Public License/);
      expect(normalized, flavor).toMatch(/Apache License|Apache-2\.0/);
      // O texto da licença (não só o nome).
      expect(normalized, flavor).toMatch(/Mozilla Public License,? Version 2\.0/i);
      expect(normalized, flavor).toMatch(/Apache License,? Version 2\.0/i);
    }
  }, 600_000);
});

describe('licença da mediabunny no bundle do offscreen', () => {
  it('SPEC-0014:UT-07 mediabunny está no package.json com versão exata (sem ^ nem ~)', () => {
    const version = declared('mediabunny');

    expect(version, 'mediabunny declarada').toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(version).not.toMatch(/[\^~*xX<>=|\s]/);
  });

  it('SPEC-0014:UT-07 o chunk do offscreen (com o que ele importa) preserva os comentários de licença da mediabunny', () => {
    build();
    for (const flavor of flavors) {
      const entries = jsFiles(out(flavor)).filter((f) =>
        /[\\/]chunks[\\/]offscreen-[^\\/]+\.js$/.test(f),
      );
      expect(entries, `${flavor}: chunk do offscreen`).toHaveLength(1);
      const files = [...reachable(entries[0] as string)];
      const license = flat(files.map((f) => readFileSync(f, 'utf8')).join('\n'));
      expect(license, `${flavor}: titular`).toMatch(/Vanilagy/);
      expect(license, `${flavor}: licença`).toMatch(/Mozilla Public License/);
      expect(license, `${flavor}: aviso MPL`).toMatch(/mozilla\.org\/MPL\/2\.0/);
    }
  }, 600_000);

  it('SPEC-0014:UT-07 popup e background não carregam a biblioteca (só o offscreen)', () => {
    build();
    for (const flavor of flavors) {
      const background = readFileSync(join(out(flavor), 'background.js'), 'utf8');
      expect(background, flavor).not.toMatch(/Vanilagy/);
      for (const file of jsFiles(out(flavor)).filter((f) => /[\\/]chunks[\\/]popup-/.test(f))) {
        expect(readFileSync(file, 'utf8'), `${flavor}: ${file}`).not.toMatch(/Vanilagy/);
      }
    }
  }, 600_000);
});
