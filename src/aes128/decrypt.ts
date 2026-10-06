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

const KNOWN_FMP4_BOXES = new Set(['ftyp', 'styp', 'moof', 'sidx', 'moov']);

export async function decryptSegment(
  key: CryptoKey,
  iv: Uint8Array,
  bytes: Uint8Array,
  type?: 'ts' | 'fmp4',
): Promise<Uint8Array> {
  if (bytes.length === 0 || bytes.length % 16 !== 0) {
    throw new DecryptError('DECRYPT_FAILED: tamanho do texto cifrado não é múltiplo de 16');
  }
  if (iv.length !== 16) {
    throw new DecryptError('DECRYPT_FAILED: IV deve ter exatamente 16 bytes');
  }

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv as BufferSource },
      key,
      bytes as BufferSource,
    );
  } catch (error) {
    throw new DecryptError(
      `DECRYPT_FAILED: falha ao descriptografar (${error instanceof Error ? error.message : 'padding inválido'})`,
    );
  }

  const decrypted = new Uint8Array(decryptedBuffer);

  if (type === 'ts') {
    if (decrypted.length === 0 || decrypted[0] !== 0x47) {
      throw new DecryptError('DECRYPT_FAILED: texto claro TS inválido (sync byte 0x47 ausente)');
    }
  } else if (type === 'fmp4') {
    if (decrypted.length < 8) {
      throw new DecryptError('DECRYPT_FAILED: texto claro fMP4 muito curto');
    }
    const boxType = String.fromCharCode(
      decrypted[4] ?? 0,
      decrypted[5] ?? 0,
      decrypted[6] ?? 0,
      decrypted[7] ?? 0,
    );
    if (!KNOWN_FMP4_BOXES.has(boxType)) {
      throw new DecryptError(`DECRYPT_FAILED: texto claro fMP4 sem caixa conhecida (${boxType})`);
    }
  }

  return decrypted;
}
