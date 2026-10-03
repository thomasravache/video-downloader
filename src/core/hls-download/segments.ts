/** Segmentos de uma playlist de mídia (SPEC-0012:IT-01). Reaproveita a análise da SPEC-0011. */
import { HlsParseError } from '../hls';
import { Parser } from 'm3u8-parser';

/** Faixa de bytes de um recurso (SPEC-0013): inteiros seguros, `length >= 1`, `offset >= 0`. */
export interface ByteRange {
  offset: number;
  length: number;
}

export interface MediaSegments {
  /** URLs absolutas http(s) dos segmentos, na ordem da playlist. */
  urls: string[];
  /** URL absoluta http(s) do EXT-X-MAP (fMP4), quando houver. */
  initUrl?: string;
  /** Soma das durações (EXTINF) em segundos. */
  durationSec: number;
  fmp4: boolean;
  /** Mesmo tamanho e ordem de `urls`; presente só se algum segmento tem BYTERANGE (SPEC-0013). */
  ranges?: (ByteRange | undefined)[];
  /** BYTERANGE do EXT-X-MAP, com offset resolvido (SPEC-0013). */
  initRange?: ByteRange;
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
const RANGE_TEXT = /^(\d+)(?:@(\d+))?$/;

/** `<n>[@<o>]` estrito (só dígitos); inteiros seguros, `n >= 1`, `o >= 0`, `o + n` seguro. */
function parseRangeText(raw: string): { length: number; offset?: number } {
  const match = RANGE_TEXT.exec(raw.trim());
  if (!match) {
    throw new HlsParseError();
  }
  const length = Number(match[1]);
  const offset = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new HlsParseError();
  }
  if (
    offset !== undefined &&
    (!Number.isSafeInteger(offset) || offset + length > Number.MAX_SAFE_INTEGER)
  ) {
    throw new HlsParseError();
  }
  return offset === undefined ? { length } : { length, offset };
}

function attributesOf(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    const raw = match[2] ?? '';
    attributes.set(match[1] as string, raw.startsWith('"') ? raw.slice(1, -1) : raw);
  }
  return attributes;
}

interface RawLayout {
  /** BYTERANGE bruto de cada segmento, na ordem (`undefined` = sem BYTERANGE). */
  segmentRanges: (string | undefined)[];
  /** Linhas EXT-X-MAP (texto dos atributos). */
  maps: string[];
}

/**
 * Lê o texto bruto: o m3u8-parser descarta em silêncio BYTERANGE malformado, o que faria o segmento ser
 * baixado inteiro e corromperia o arquivo; por isso a faixa é validada aqui, a partir do texto.
 */
function scanLayout(text: string): RawLayout {
  const segmentRanges: (string | undefined)[] = [];
  const maps: string[] = [];
  let pending: string | undefined;
  for (const rawLine of text.split(/\r?\n|\r/)) {
    const line = rawLine.trim();
    if (line === '') {
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pending = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (line.startsWith('#EXT-X-MAP:')) {
      maps.push(line.slice('#EXT-X-MAP:'.length));
    } else if (!line.startsWith('#')) {
      segmentRanges.push(pending);
      pending = undefined;
    }
  }
  return { segmentRanges, maps };
}

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
  const layout = scanLayout(text);
  if (layout.segmentRanges.length !== urls.length) {
    throw new HlsParseError();
  }
  let ranges: (ByteRange | undefined)[] | undefined;
  if (layout.segmentRanges.some((raw) => raw !== undefined)) {
    const ends = new Map<string, number>();
    ranges = layout.segmentRanges.map((raw, i) => {
      if (raw === undefined) {
        return undefined;
      }
      const url = urls[i] as string;
      const parsed = parseRangeText(raw);
      const offset = parsed.offset ?? ends.get(url);
      if (offset === undefined || offset + parsed.length > Number.MAX_SAFE_INTEGER) {
        throw new HlsParseError();
      }
      ends.set(url, offset + parsed.length);
      return { offset, length: parsed.length };
    });
  }
  let initRange: ByteRange | undefined;
  const mapRanges = layout.maps.map((line) => attributesOf(line).get('BYTERANGE'));
  if (mapRanges.some((raw) => raw !== undefined)) {
    if (new Set(layout.maps).size > 1) {
      throw new HlsParseError();
    }
    const parsed = parseRangeText(mapRanges[0] as string);
    if (parsed.offset === undefined) {
      throw new HlsParseError();
    }
    initRange = { offset: parsed.offset, length: parsed.length };
  }
  const mapUri = segments.find((segment) => segment.map?.uri !== undefined)?.map?.uri;
  const initUrl = typeof mapUri === 'string' ? absoluteHttp(mapUri, baseUrl) : undefined;
  if (initRange !== undefined && initUrl === undefined) {
    throw new HlsParseError();
  }
  return {
    urls,
    ...(initUrl !== undefined && { initUrl }),
    durationSec: segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0),
    fmp4: initUrl !== undefined,
    ...(ranges !== undefined && { ranges }),
    ...(initRange !== undefined && { initRange }),
  };
}
