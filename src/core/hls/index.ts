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
  /** AUDIO="grupo" da STREAM-INF (SPEC-0014). */
  audioGroup?: string;
}

/** Faixa de áudio de `#EXT-X-MEDIA:TYPE=AUDIO` com URI (SPEC-0014); extensão ADITIVA de HlsInfo. */
export interface HlsAudioTrack {
  /** Posição na lista devolvida. */
  index: number;
  /** GROUP-ID. */
  groupId: string;
  /** NAME, sem caracteres de controle, no máximo 80 caracteres. */
  name: string;
  /** LANGUAGE, no máximo 16 caracteres. */
  language?: string;
  /** DEFAULT=YES. */
  default: boolean;
  /** URI resolvida; só http(s). */
  url: string;
}

export interface HlsInfo {
  type: 'master' | 'media' | 'subtitles';
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
  /** Faixas de áudio separadas da master (máx. 20); ausente se não há faixa com URI (SPEC-0014). */
  audio?: HlsAudioTrack[];
  /** SPEC-0015: origem+caminho (sem query/fragmento) dos arquivos de mídia citados pelas playlists de variante/áudio buscadas no resolve; únicos; máx. 32. */
  mediaResources?: string[];
  /** SPEC-0017: só no flavor local, quando todas as chaves são AES-128 válidas; então encrypted === false. */
  aes128?: true;
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
const MAX_AUDIO_TRACKS = 20;
const MAX_MEDIA_RESOURCES = 32;
const MAX_NAME = 80;
const MAX_LANGUAGE = 16;
const MAX_GROUP_ID = 200;
// `#EXT-X-FAXS-CM` (DRM Adobe, obsoleta) também nunca é limpa (SPEC-0012).
const KEY_PREFIXES = ['#EXT-X-KEY', '#EXT-X-SESSION-KEY', '#EXT-X-FAXS-CM'];
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

/** Controle (C0/C1) e formatação Unicode (`Cf`: bidi, largura zero): invisíveis e usados para disfarçar texto. */
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;

/** Texto de atributo sem caracteres invisíveis, com espaços normalizados, aparado e truncado (sem partir um par substituto). */
function cleanText(value: string, max: number): string {
  const text = value.replace(HIDDEN_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return /[\ud800-\udbff]$/.test(text) ? text.slice(0, -1) : text;
}

/** Lista de atributos de uma tag (`CHAVE=valor,CHAVE="texto, com vírgula"`); trecho malformado encerra a leitura. */
function parseAttributes(list: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pair = /^([A-Za-z0-9-]+)=(?:"([^"]*)"|([^,"]*))(?:,|$)/;
  for (let rest = list; rest !== '';) {
    const match = pair.exec(rest);
    if (match === null) {
      break;
    }
    if (!attributes.has(match[1] as string)) {
      attributes.set(match[1] as string, match[2] ?? match[3] ?? '');
    }
    rest = rest.slice(match[0].length);
  }
  return attributes;
}

/** Faixas de `#EXT-X-MEDIA:TYPE=AUDIO` com URI http(s) (linhas brutas: o parser colapsaria NAMEs repetidos). */
function audioTracksOf(lines: string[], baseUrl: string): HlsAudioTrack[] {
  const tracks: HlsAudioTrack[] = [];
  for (const line of lines) {
    if (tracks.length >= MAX_AUDIO_TRACKS) {
      break;
    }
    if (!line.startsWith('#EXT-X-MEDIA:')) {
      continue;
    }
    const attributes = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
    const uri = attributes.get('URI');
    const groupId = cleanText(attributes.get('GROUP-ID') ?? '', MAX_GROUP_ID);
    if (attributes.get('TYPE') !== 'AUDIO' || groupId === '' || uri === undefined || uri === '') {
      continue;
    }
    const url = absoluteHttp(uri, baseUrl);
    if (url === undefined) {
      continue;
    }
    const language = cleanText(attributes.get('LANGUAGE') ?? '', MAX_LANGUAGE);
    tracks.push({
      index: tracks.length,
      groupId,
      name: cleanText(attributes.get('NAME') ?? '', MAX_NAME) || 'Audio',
      ...(language !== '' && { language }),
      default: attributes.get('DEFAULT') === 'YES',
      url,
    });
  }
  return tracks;
}

function label(bandwidth: number, height: number | undefined): string {
  return height !== undefined && height > 0
    ? `${String(height)}p`
    : `${String(Math.round(bandwidth / 1000))} kbps`;
}

export function variantsOf(manifest: ParsedManifest, baseUrl: string): HlsVariant[] {
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
    const audioGroup =
      typeof attributes.AUDIO === 'string' ? cleanText(attributes.AUDIO, MAX_GROUP_ID) : '';
    return [
      {
        url,
        bandwidth,
        ...(typeof width === 'number' && width > 0 && { width }),
        ...(typeof height === 'number' && height > 0 && { height }),
        ...(typeof attributes.CODECS === 'string' && { codecs: attributes.CODECS }),
        ...(audioGroup !== '' && { audioGroup }),
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

/** Interface mínima para classificação de chaves injetada em parseHlsPlaylist (evita ciclo com ports.ts). */
export interface KeyClassifier {
  classify(
    playlistText: string,
    baseUrl: string,
  ): { kind: 'none' | 'aes128' | 'protected'; [key: string]: unknown };
}

/** Interpreta uma playlist HLS (master ou de mídia); lança `HlsParseError` se vazia ou inválida. */
export function parseHlsPlaylist(
  text: string,
  baseUrl: string,
  keyPolicy?: KeyClassifier,
): HlsInfo {
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
    let encrypted = hasEncryptedKey(text);
    let aes128: true | undefined = undefined;
    if (keyPolicy !== undefined) {
      const verdict = keyPolicy.classify(text, baseUrl);
      if (verdict.kind === 'aes128') {
        encrypted = false;
        aes128 = true;
      } else if (verdict.kind === 'none') {
        encrypted = false;
        aes128 = undefined;
      } else {
        encrypted = true;
        aes128 = undefined;
      }
    }
    const fmp4 = lines.some((line) => line.startsWith('#EXT-X-MAP:'));
    const segments = manifest.segments ?? [];
    const variants = variantsOf(manifest, baseUrl);
    if (variants.length > 0) {
      const audio = audioTracksOf(lines, baseUrl);
      return {
        type: 'master',
        variants,
        encrypted,
        live: false,
        fmp4,
        ...(audio.length > 0 && { audio }),
        ...(aes128 === true && { aes128 }),
      };
    }
    if (segments.length === 0) {
      throw new HlsParseError();
    }
    const isSubtitles = segments.some((segment) => {
      const uri = (segment.uri ?? '').toLowerCase().split(/[?#]/)[0] ?? '';
      return uri.endsWith('.vtt') || uri.endsWith('.webvtt');
    });
    return {
      type: isSubtitles ? 'subtitles' : 'media',
      variants: [],
      durationSec: segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0),
      segmentCount: segments.length,
      encrypted,
      live: manifest.endList !== true,
      fmp4,
      ...(aes128 === true && { aes128 }),
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
    optional(value['codecs'], (v) => typeof v === 'string') &&
    optional(value['audioGroup'], (v) => typeof v === 'string')
  );
}

const isHttpUrl = (value: unknown): boolean =>
  typeof value === 'string' && absoluteHttp(value, 'http://x/') === value;

function isAudioTrack(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['index'] === 'number' &&
    Number.isInteger(value['index']) &&
    value['index'] >= 0 &&
    typeof value['groupId'] === 'string' &&
    typeof value['name'] === 'string' &&
    optional(value['language'], (v) => typeof v === 'string') &&
    typeof value['default'] === 'boolean' &&
    isHttpUrl(value['url'])
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
  const audio = input['audio'];
  if (!optional(audio, (v) => Array.isArray(v) && (v as unknown[]).every(isAudioTrack))) {
    return { ok: false, error: 'audio inválido (index, groupId, name, default e url http(s))' };
  }
  const resources = input['mediaResources'];
  if (
    !optional(
      resources,
      (v) =>
        Array.isArray(v) &&
        v.length <= MAX_MEDIA_RESOURCES &&
        (v as unknown[]).every((item) => typeof item === 'string'),
    )
  ) {
    return { ok: false, error: 'mediaResources inválido (lista de até 32 textos)' };
  }
  if ('aes128' in input && input['aes128'] !== undefined) {
    if (input['aes128'] !== true) {
      return { ok: false, error: 'aes128 deve ser true quando presente' };
    }
    if (input['encrypted'] === true) {
      return { ok: false, error: 'aes128 e encrypted não podem ser ambos true' };
    }
  }
  return { ok: true, value: input as unknown as HlsInfo };
}
