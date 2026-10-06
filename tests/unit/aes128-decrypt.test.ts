/**
 * SPEC-0017:UT-03 — Descriptografia AES-128-CBC, validação PKCS7 e sanidade TS/fMP4.
 */
import { describe, expect, it } from 'vitest';
import { decryptSegment } from '../../src/aes128/decrypt';
import { encryptAes128Cbc } from './support/aes128-crypto';

const KEY_BYTES = new Uint8Array([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);
const WRONG_KEY_BYTES = new Uint8Array(16).fill(0xff);
const IV = new Uint8Array(16).fill(0x00);
const WRONG_IV = new Uint8Array(16).fill(0xaa);

async function toCryptoKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-CBC', false, ['decrypt']);
}

describe('SPEC-0017:UT-03 descriptografia de segmentos com WebCrypto e sanidade', () => {
  it('SPEC-0017:UT-03 descriptografa com sucesso quando chave e IV estão corretos e o texto claro é TS válido (inicia com 0x47)', async () => {
    const key = await toCryptoKey(KEY_BYTES);
    // Pacote TS sintético: 188 bytes começando com 0x47
    const plaintextTs = new Uint8Array(188);
    plaintextTs[0] = 0x47;
    for (let i = 1; i < 188; i++) plaintextTs[i] = i % 256;

    const ciphertext = encryptAes128Cbc(KEY_BYTES, IV, plaintextTs);
    const decrypted = await decryptSegment(key, IV, ciphertext, 'ts');

    expect(decrypted).toEqual(plaintextTs);
    expect(decrypted[0]).toBe(0x47);
  });

  it('SPEC-0017:UT-03 descriptografa com sucesso fMP4 com caixa ftyp conhecida', async () => {
    const key = await toCryptoKey(KEY_BYTES);
    // Caixa ftyp básica: 4 bytes length (16), 'ftyp', 'isom', minor_version (0)
    const plaintextFmp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00,
      0x00,
    ]);

    const ciphertext = encryptAes128Cbc(KEY_BYTES, IV, plaintextFmp4);
    const decrypted = await decryptSegment(key, IV, ciphertext, 'fmp4');

    expect(decrypted).toEqual(plaintextFmp4);
  });

  it('SPEC-0017:UT-03 falha com DECRYPT_FAILED com chave ou IV incorretos', async () => {
    const wrongKey = await toCryptoKey(WRONG_KEY_BYTES);
    const plaintextTs = new Uint8Array(188);
    plaintextTs[0] = 0x47;

    const ciphertext = encryptAes128Cbc(KEY_BYTES, IV, plaintextTs);

    await expect(decryptSegment(wrongKey, IV, ciphertext, 'ts')).rejects.toThrow(/DECRYPT_FAILED/);
    const correctKey = await toCryptoKey(KEY_BYTES);
    await expect(decryptSegment(correctKey, WRONG_IV, ciphertext, 'ts')).rejects.toThrow(
      /DECRYPT_FAILED/,
    );
  });

  it('SPEC-0017:UT-03 falha com DECRYPT_FAILED quando tamanho do texto cifrado não é múltiplo de 16', async () => {
    const key = await toCryptoKey(KEY_BYTES);
    const notMultipleOf16 = new Uint8Array(35);

    await expect(decryptSegment(key, IV, notMultipleOf16, 'ts')).rejects.toThrow(/DECRYPT_FAILED/);
  });

  it('SPEC-0017:UT-03 falha com DECRYPT_FAILED quando o padding PKCS7 é corrompido', async () => {
    const key = await toCryptoKey(KEY_BYTES);
    const plaintextTs = new Uint8Array(188);
    plaintextTs[0] = 0x47;

    const ciphertext = encryptAes128Cbc(KEY_BYTES, IV, plaintextTs);
    const last = ciphertext[ciphertext.length - 1] ?? 0;
    ciphertext[ciphertext.length - 1] = last ^ 0xff;

    await expect(decryptSegment(key, IV, ciphertext, 'ts')).rejects.toThrow(/DECRYPT_FAILED/);
  });

  it('SPEC-0017:UT-03 sanidade: falha com DECRYPT_FAILED quando texto claro TS não inicia com 0x47', async () => {
    const key = await toCryptoKey(KEY_BYTES);
    const badTs = new Uint8Array(188);
    badTs[0] = 0x00; // não é 0x47

    const ciphertext = encryptAes128Cbc(KEY_BYTES, IV, badTs);
    await expect(decryptSegment(key, IV, ciphertext, 'ts')).rejects.toThrow(/DECRYPT_FAILED/);
  });

  it('SPEC-0017:UT-03 sanidade: falha com DECRYPT_FAILED quando texto claro fMP4 não possui caixa conhecida', async () => {
    const key = await toCryptoKey(KEY_BYTES);
    const badFmp4 = new Uint8Array(32).fill(0x00); // sem caixa conhecida (ftyp/styp/moof/sidx/moov)

    const ciphertext = encryptAes128Cbc(KEY_BYTES, IV, badFmp4);
    await expect(decryptSegment(key, IV, ciphertext, 'fmp4')).rejects.toThrow(/DECRYPT_FAILED/);
  });
});
