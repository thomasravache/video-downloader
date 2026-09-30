import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT, run } from './helpers';

const CONFIG = join(ROOT, '.gitleaks.toml');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const dirs: string[] = [];

/** Token fictício no formato de chave de acesso AWS, gerado em runtime (nunca um segredo real). */
function fakeAwsAccessKeyId(): string {
  let body = '';
  for (let i = 0; i < 16; i++) body += ALPHABET.charAt(randomInt(ALPHABET.length));
  return `AKIA${body}`;
}

function scan(dir: string) {
  return run('gitleaks', [
    'detect',
    '--no-git',
    '--source',
    dir,
    '--config',
    CONFIG,
    '--no-banner',
  ]);
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spec0004-gitleaks-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('gitleaks com a config do repositório', () => {
  it('SPEC-0004:IT-02 .gitleaks.toml existe na raiz', () => {
    expect(existsSync(CONFIG), '.gitleaks.toml ausente').toBe(true);
  });

  it('SPEC-0004:IT-02 detecta token fictício (exit ≠ 0) e passa sem ele (exit 0)', () => {
    expect(existsSync(CONFIG), '.gitleaks.toml ausente').toBe(true);

    const dirty = tempDir();
    mkdirSync(join(dirty, 'src'));
    writeFileSync(
      join(dirty, 'src', 'config.ts'),
      `export const awsAccessKeyId = "${fakeAwsAccessKeyId()}";\n`,
    );
    const leak = scan(dirty);
    expect(leak.error, 'gitleaks não executou').toBeUndefined();
    expect(leak.code, leak.out).not.toBe(0);
    expect(leak.out).toMatch(/leaks? found|leaks:\s*[1-9]|aws/i);

    const clean = tempDir();
    writeFileSync(join(clean, 'readme.txt'), 'nada sensível aqui\n');
    const ok = scan(clean);
    expect(ok.error, 'gitleaks não executou').toBeUndefined();
    expect(ok.code, ok.out).toBe(0);
  });
});
