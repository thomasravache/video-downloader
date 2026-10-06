/**
 * Descriptografia de segmentos HLS com WebCrypto AES-CBC e PKCS7 (SPEC-0017).
 * Marcador obrigatório:
 * VD_AES128_LOCAL_ONLY
 */
export const VD_AES128_LOCAL_ONLY = 'VD_AES128_LOCAL_ONLY';

export class DecryptError extends Error {
  readonly code = 'DECRYPT_FAILED';
  constructor(message = 'DECRYPT_FAILED') {
    super(message);
    this.name = 'DecryptError';
  }
}

export function decryptSegment(
  _key: CryptoKey,
  _iv: Uint8Array,
  _bytes: Uint8Array,
  _type?: 'ts' | 'fmp4',
): Promise<Uint8Array> {
  return Promise.reject(new Error('NotImplemented'));
}
