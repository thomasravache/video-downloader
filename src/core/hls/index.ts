/** Playlists HLS (SPEC-0011): parse puro sobre `m3u8-parser` (ADR-0013); HlsInfo versão 1. */

import { Parser } from 'm3u8-parser';
import type { ParsedManifest } from 'm3u8-parser';

export interface HlsVariant {
  index: number;
  url: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  label: string;
}

export interface HlsInfo {
  type: 'master' | 'media';
  /** master: da maior para a menor banda; media: []. */
  variants: HlsVariant[];
  durationSec?: number;
  segmentCount?: number;
  /** Qualquer tag de chave que não seja exatamente `#EXT-X-KEY:METHOD=NONE` (lista de permissão). */
  encrypted: boolean;
  /** Sem EXT-X-ENDLIST. */
  live: boolean;
  /** EXT-X-MAP presente. */
  fmp4: boolean;
}

/** Playlist vazia ou inválida. */
export class HlsParseError extends Error {
  readonly code = 'HLS_PARSE_FAILED';
  constructor(message = 'HLS_PARSE_FAILED') {
    super(message);
    this.name = 'HlsParseError';
  }
}

export type HlsInfoValidation = { ok: true; value: HlsInfo } | { ok: false; error: string };

const MAX_VARIANTS = 50;
const KEY_PREFIXES = ['#EXT-X-KEY', '#EXT-X-SESSION-KEY'];
const CLEAN_KEY_LINE = '#EXT-X-KEY:METHOD=NONE';

/**
 * Lista de permissão sobre o texto bruto (o `m3u8-parser` ignora chaves sem URI e esquece uma chave AES
 * depois de `METHOD=NONE`): cada ocorrência de `#EXT-X-KEY` ou `#EXT-X-SESSION-KEY` vai até o próximo
 * `\n` (tolerando um único `\r` final) e só a linha exata `#EXT-X-KEY:METHOD=NONE` é limpa.
 */
function hasEncryptedKey(text: string): boolean {
  for (const prefix of KEY_PREFIXES) {
    for (let at = text.indexOf(prefix); at >= 0; at = text.indexOf(prefix, at + prefix.length)) {
      const end = text.indexOf('\n', at);
      const line = text.slice(at, end < 0 ? text.length : end).replace(/\r$/, '');
      if (line !== CLEAN_KEY_LINE) {
        return true;
      }
    }
  }
  return false;
}

/** URL absoluta http(s) ou `undefined` (outros esquemas e URLs inválidas são descartados). */
function absoluteHttp(uri: string, baseUrl: string): string | undefined {
  try {
    const { href, protocol } = new URL(uri, baseUrl);
    return protocol === 'http:' || protocol === 'https:' ? href : undefined;
  } catch {
    return undefined;
  }
}

function label(bandwidth: number, height: number | undefined): string {
  return height !== undefined && height > 0
    ? `${String(height)}p`
    : `${String(Math.round(bandwidth / 1000))} kbps`;
}

function variantsOf(manifest: ParsedManifest, baseUrl: string): HlsVariant[] {
  const found = (manifest.playlists ?? []).flatMap((playlist) => {
    if (typeof playlist.uri !== 'string' || playlist.uri === '') {
      return [];
    }
    const url = absoluteHttp(playlist.uri, baseUrl);
    if (url === undefined) {
      return [];
    }
    const attributes = playlist.attributes ?? {};
    const bandwidth =
      typeof attributes.BANDWIDTH === 'number' && Number.isFinite(attributes.BANDWIDTH)
        ? attributes.BANDWIDTH
        : 0;
    const { width, height } = attributes.RESOLUTION ?? {};
    return [
      {
        url,
        bandwidth,
        ...(typeof width === 'number' && width > 0 && { width }),
        ...(typeof height === 'number' && height > 0 && { height }),
        ...(typeof attributes.CODECS === 'string' && { codecs: attributes.CODECS }),
      },
    ];
  });
  // `sort` é estável: variantes de mesma banda mantêm a ordem do arquivo.
  return found
    .sort((a, b) => b.bandwidth - a.bandwidth)
    .slice(0, MAX_VARIANTS)
    .map((variant, index) => ({
      index,
      ...variant,
      label: label(variant.bandwidth, variant.height),
    }));
}

/** Interpreta uma playlist HLS (master ou de mídia); lança `HlsParseError` se vazia ou inválida. */
export function parseHlsPlaylist(text: string, baseUrl: string): HlsInfo {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim());
  if (lines.find((line) => line !== '') !== '#EXTM3U') {
    throw new HlsParseError();
  }
  try {
    new URL(baseUrl);
    // O parser de playlists é tolerante (aceita lixo) e pode lançar em atributos malformados.
    const parser = new Parser();
    parser.push(text);
    parser.end();
    const { manifest } = parser;
    const encrypted = hasEncryptedKey(text);
    const fmp4 = lines.some((line) => line.startsWith('#EXT-X-MAP:'));
    const segments = manifest.segments ?? [];
    const variants = variantsOf(manifest, baseUrl);
    if (variants.length > 0) {
      return { type: 'master', variants, encrypted, live: false, fmp4 };
    }
    if (segments.length === 0) {
      throw new HlsParseError();
    }
    return {
      type: 'media',
      variants: [],
      durationSec: segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0),
      segmentCount: segments.length,
      encrypted,
      live: manifest.endList !== true,
      fmp4,
    };
  } catch (error) {
    throw error instanceof HlsParseError ? error : new HlsParseError();
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const optional = (value: unknown, check: (v: unknown) => boolean): boolean =>
  value === undefined || check(value);

function isVariant(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['index'] === 'number' &&
    Number.isInteger(value['index']) &&
    typeof value['url'] === 'string' &&
    value['url'] !== '' &&
    isNumber(value['bandwidth']) &&
    typeof value['label'] === 'string' &&
    optional(value['width'], isNumber) &&
    optional(value['height'], isNumber) &&
    optional(value['codecs'], (v) => typeof v === 'string')
  );
}

/** Valida um HlsInfo v1 (SPEC-0011:CT-01); escrito à mão, sem biblioteca de schema. */
export function validateHlsInfo(input: unknown): HlsInfoValidation {
  if (!isRecord(input)) {
    return { ok: false, error: 'HlsInfo deve ser um objeto' };
  }
  if (input['type'] !== 'master' && input['type'] !== 'media') {
    return { ok: false, error: "type deve ser 'master' ou 'media'" };
  }
  for (const flag of ['encrypted', 'live', 'fmp4']) {
    if (typeof input[flag] !== 'boolean') {
      return { ok: false, error: `${flag} deve ser booleano` };
    }
  }
  const { variants } = input;
  if (!Array.isArray(variants) || !(variants as unknown[]).every(isVariant)) {
    return {
      ok: false,
      error: 'variants inválido (index, url, bandwidth e label são obrigatórios)',
    };
  }
  if (!optional(input['durationSec'], isNumber) || !optional(input['segmentCount'], isNumber)) {
    return { ok: false, error: 'durationSec e segmentCount devem ser números' };
  }
  return { ok: true, value: input as unknown as HlsInfo };
}
