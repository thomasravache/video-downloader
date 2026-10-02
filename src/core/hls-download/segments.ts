/** Segmentos de uma playlist de mídia (SPEC-0012:IT-01). Assinatura apenas. */

export interface MediaSegments {
  /** URLs absolutas http(s) dos segmentos, na ordem da playlist. */
  urls: string[];
  /** URL absoluta http(s) do EXT-X-MAP (fMP4), quando houver. */
  initUrl?: string;
  /** Soma das durações (EXTINF) em segundos. */
  durationSec: number;
  fmp4: boolean;
}

/**
 * Lê a playlist de MÍDIA (`text`, buscada de `baseUrl`) e devolve os segmentos. Nunca devolve URL que
 * não seja http(s): playlist com segmento/init de outro esquema é recusada (lança `HlsParseError`).
 * Playlist de master ou vazia também lança `HlsParseError`.
 */
export function parseMediaSegments(_text: string, _baseUrl: string): MediaSegments {
  throw new Error('NotImplemented');
}
