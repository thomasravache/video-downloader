/** Segmentos de uma playlist de mídia (SPEC-0012:IT-01). Reaproveita a análise da SPEC-0011. */
import { HlsParseError } from '../hls';
import { Parser } from 'm3u8-parser';

export interface MediaSegments {
  /** URLs absolutas http(s) dos segmentos, na ordem da playlist. */
  urls: string[];
  /** URL absoluta http(s) do EXT-X-MAP (fMP4), quando houver. */
  initUrl?: string;
  /** Soma das durações (EXTINF) em segundos. */
  durationSec: number;
  fmp4: boolean;
}

function absoluteHttp(uri: string, baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri, baseUrl);
  } catch {
    throw new HlsParseError();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HlsParseError();
  }
  return parsed.href;
}

/**
 * Lê a playlist de MÍDIA (`text`, buscada de `baseUrl`) e devolve os segmentos. Nunca devolve URL que
 * não seja http(s): playlist com segmento/init de outro esquema é recusada (lança `HlsParseError`).
 * Playlist de master ou vazia também lança `HlsParseError`.
 */
export function parseMediaSegments(text: string, baseUrl: string): MediaSegments {
  if (!/^﻿?\s*#EXTM3U/.test(text)) {
    throw new HlsParseError();
  }
  const parser = new Parser();
  try {
    parser.push(text);
    parser.end();
  } catch {
    throw new HlsParseError();
  }
  const { manifest } = parser;
  if ((manifest.playlists ?? []).length > 0) {
    throw new HlsParseError();
  }
  const segments = manifest.segments ?? [];
  if (segments.length === 0) {
    throw new HlsParseError();
  }
  const urls = segments.map((segment) => {
    if (typeof segment.uri !== 'string' || segment.uri === '') {
      throw new HlsParseError();
    }
    return absoluteHttp(segment.uri, baseUrl);
  });
  const mapUri = segments.find((segment) => segment.map?.uri !== undefined)?.map?.uri;
  const initUrl = typeof mapUri === 'string' ? absoluteHttp(mapUri, baseUrl) : undefined;
  return {
    urls,
    ...(initUrl !== undefined && { initUrl }),
    durationSec: segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0),
    fmp4: initUrl !== undefined,
  };
}
