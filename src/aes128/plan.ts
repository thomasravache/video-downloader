/**
 * Montagem de EncryptionPlan e derivação de IV para HLS AES-128 (SPEC-0017).
 * Marcador obrigatório:
 * VD_AES128_LOCAL_ONLY
 */
import type { EncryptionPlan } from '../core/hls-download/protocol';

export const VD_AES128_LOCAL_ONLY = 'VD_AES128_LOCAL_ONLY';

export function buildEncryptionPlan(_playlistText: string, _baseUrl: string): EncryptionPlan {
  throw new Error('NotImplemented');
}

export function deriveIv(_mediaSequence: number, _segmentIndex: number): Uint8Array {
  throw new Error('NotImplemented');
}
