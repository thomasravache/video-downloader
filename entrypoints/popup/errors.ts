import type { ResolveHlsResponse } from '../../src/core/contracts';

/** Textos usados para o erro do cartão HLS (subconjunto de `ViewText`). */
export interface HlsErrorTexts {
  hlsErrorFetch: string;
  hlsErrorParse: string;
  hlsErrorGeneric: string;
  hlsErrorExpired: string;
}

/** Texto do erro de `resolveHls` no cartão HLS (SPEC-0016: 401/403 viram `hlsErrorExpired`). */
export function hlsErrorText(
  response: ResolveHlsResponse | undefined,
  text: HlsErrorTexts,
): string {
  if (response?.ok !== false) {
    return text.hlsErrorGeneric;
  }
  if (response.error === 'HLS_FETCH_FAILED') {
    return response.status === 401 || response.status === 403
      ? text.hlsErrorExpired
      : text.hlsErrorFetch;
  }
  return response.error === 'HLS_PARSE_FAILED' ? text.hlsErrorParse : text.hlsErrorGeneric;
}
