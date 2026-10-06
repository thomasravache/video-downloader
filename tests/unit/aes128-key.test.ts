/**
 * SPEC-0017:UT-04 — Validação de 16 bytes, import não-extraível e descarte seguro em memória.
 */
import { describe, expect, it } from 'vitest';
import { loadKey } from '../../src/aes128/keys';

describe('SPEC-0017:UT-04 manuseio e segurança da chave AES-128', () => {
  it('SPEC-0017:UT-04 aceita exatamente 16 bytes, retornando CryptoKey não extraível com algoritmo AES-CBC', async () => {
    const raw = new Uint8Array([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
      0x0f,
    ]);
    const cryptoKey = await loadKey(raw);

    expect(cryptoKey.type).toBe('secret');
    expect(cryptoKey.extractable).toBe(false);
    expect(cryptoKey.algorithm.name).toBe('AES-CBC');
  });

  it('SPEC-0017:UT-04 zera o buffer bruto fornecido após a importação', async () => {
    const raw = new Uint8Array(16).fill(0x42);
    await loadKey(raw);

    expect(raw.every((byte) => byte === 0)).toBe(true);
  });

  it('SPEC-0017:UT-04 recusa respostas de chave com 0, 15, 17 e 64+ bytes com erro KEY_FAILED', async () => {
    const invalidSizes = [0, 15, 17, 64, 128];
    for (const size of invalidSizes) {
      const buffer = new Uint8Array(size).fill(0x01);
      await expect(loadKey(buffer), `esperava falha para tamanho: ${String(size)}`).rejects.toThrow(
        /KEY_FAILED/,
      );
    }
  });

  it('SPEC-0017:UT-04 material bruto de chave não é serializável nem exposto em JSON', async () => {
    const raw = new Uint8Array(16).fill(0x33);
    const cryptoKey = await loadKey(raw);

    const serialized = JSON.stringify({ key: cryptoKey });
    expect(serialized).not.toContain('33');
    expect(serialized).not.toContain('secret');
  });
});
