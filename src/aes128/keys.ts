/**
 * Importação e manuseio seguro de chave AES-128 (SPEC-0017).
 * Marcador obrigatório:
 * VD_AES128_LOCAL_ONLY
 */
export const VD_AES128_LOCAL_ONLY = 'VD_AES128_LOCAL_ONLY';

export class KeyFetchError extends Error {
  readonly code = 'KEY_FAILED';
  constructor(message = 'KEY_FAILED') {
    super(message);
    this.name = 'KeyFetchError';
  }
}

export async function loadKey(bytes: Uint8Array): Promise<CryptoKey> {
  try {
    if (bytes.length !== 16) {
      throw new KeyFetchError('KEY_FAILED: chave deve ter exatamente 16 bytes');
    }
    return await crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-CBC' }, false, [
      'decrypt',
    ]);
  } finally {
    bytes.fill(0);
  }
}
