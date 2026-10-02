import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, run } from './helpers';

const flavors = ['public', 'local'] as const;
const out = (f: string) => join(ROOT, '.output', `chrome-mv3-${f}`);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('pnpm build real', () => {
  it(
    'SPEC-0002:IT-01 gera os dois diretórios com manifesto MV3 e locales pt_BR/en com extName',
    () => {
      const r = run('pnpm', ['build'], 540_000);
      expect(r.code, r.out).toBe(0);

      for (const f of flavors) {
        expect(existsSync(out(f)), `${out(f)} deve existir`).toBe(true);
        const manifest = readJson(join(out(f), 'manifest.json'));
        expect(manifest.manifest_version).toBe(3);
        expect(manifest.default_locale).toBe('pt_BR');
        expect(manifest.name).toBe('__MSG_extName__');

        for (const loc of ['pt_BR', 'en']) {
          const p = join(out(f), '_locales', loc, 'messages.json');
          expect(existsSync(p), `${p} deve existir`).toBe(true);
          expect(readJson(p).extName?.message).toBeTruthy();
        }
      }

      // local distingue-se via _locales com sufixo " (local)"; public não
      for (const loc of ['pt_BR', 'en']) {
        const local = readJson(join(out('local'), '_locales', loc, 'messages.json'));
        const pub = readJson(join(out('public'), '_locales', loc, 'messages.json'));
        expect(local.extName.message).toMatch(/ \(local\)$/);
        expect(pub.extName.message).not.toMatch(/\(local\)/);
      }
    },
    600_000,
  );
});
