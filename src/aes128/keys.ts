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

export function loadKey(_bytes: Uint8Array): Promise<CryptoKey> {
  return Promise.reject(new Error('NotImplemented'));
}
