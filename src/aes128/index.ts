/**
 * Pacote de suporte a HLS AES-128 (SPEC-0017).
 * Marcador obrigatório:
 * VD_AES128_LOCAL_ONLY
 */
import { KeyFetchError, loadKey } from './keys';
import { DecryptError, decryptSegment } from './decrypt';
import { deriveIv } from './plan';

export const VD_AES128_LOCAL_ONLY = 'VD_AES128_LOCAL_ONLY';

export const aes128Handler = {
  loadKey,
  decryptSegment,
  deriveIv,
  KeyFetchError,
  DecryptError,
};

export * from './classify';
export * from './plan';
export * from './decrypt';
export * from './keys';
