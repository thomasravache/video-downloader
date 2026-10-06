/**
 * SPEC-0017:UT-07 — Presença do marcador VD_AES128_LOCAL_ONLY nos módulos reais e ausência no stub do public.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPublicDecryptStub, getPublicPolicyStub } from '../../scripts/build/aes128-plugin';

const AES128_DIR = join(import.meta.dirname, '../../src/aes128');
const MARKER = 'VD_AES128_LOCAL_ONLY';

describe('SPEC-0017:UT-07 isolamento de código por flavor e marcador de build', () => {
  it('SPEC-0017:UT-07 todos os módulos TypeScript sob src/aes128 contêm o marcador VD_AES128_LOCAL_ONLY', () => {
    const files = readdirSync(AES128_DIR)
      .filter((file) => file.endsWith('.ts') && statSync(join(AES128_DIR, file)).isFile())
      .map((file) => join(AES128_DIR, file));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      expect(content, `falta marcador ${MARKER} em ${file}`).toContain(MARKER);
    }
  });

  it('SPEC-0017:UT-07 o stub do flavor public não contém AES-CBC, decrypt nem o marcador VD_AES128_LOCAL_ONLY', () => {
    const policyStub = getPublicPolicyStub();
    const decryptStub = getPublicDecryptStub();
    const combined = `${policyStub}\n${decryptStub}`;

    expect(combined).not.toContain('AES-CBC');
    expect(combined).not.toContain('decrypt');
    expect(combined).not.toContain(MARKER);
  });
});
