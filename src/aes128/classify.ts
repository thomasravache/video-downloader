/**
 * Classificação de tags de chave HLS contra allowlist estrita (SPEC-0017).
 * Marcador obrigatório para proteção contra vazamento no build público:
 * VD_AES128_LOCAL_ONLY
 */
import type { KeyPolicyPort, KeyVerdict } from '../core/ports';

export const VD_AES128_LOCAL_ONLY = 'VD_AES128_LOCAL_ONLY';

export function classify(_playlistText: string, _baseUrl: string): KeyVerdict {
  throw new Error('NotImplemented');
}

export const keyPolicy: KeyPolicyPort = {
  classify(playlistText: string, baseUrl: string): KeyVerdict {
    return classify(playlistText, baseUrl);
  },
};
