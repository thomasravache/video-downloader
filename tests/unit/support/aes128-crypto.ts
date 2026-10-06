/**
 * Utilitários criptográficos de apoio aos testes de HLS AES-128 (SPEC-0017). Não é teste.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';

export function encryptAes128Cbc(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final()]));
}

export function decryptAes128Cbc(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

/** Converte sequência de mídia em IV big-endian de 128 bits conforme RFC 8216 §5.2. */
export function sequenceToIv(seq: number): Uint8Array {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setBigUint64(8, BigInt(seq));
  return iv;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
