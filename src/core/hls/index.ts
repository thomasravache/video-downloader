/** Playlists HLS (SPEC-0011): parse puro sobre `m3u8-parser` (ADR-0013); HlsInfo versão 1. */

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
  /** Qualquer EXT-X-KEY com METHOD ≠ NONE (inclui SAMPLE-AES) ou EXT-X-SESSION-KEY. */
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

export function parseHlsPlaylist(_text: string, _baseUrl: string): HlsInfo {
  throw new Error('NotImplemented');
}

/** Valida um HlsInfo v1 (SPEC-0011:CT-01); escrito à mão, sem biblioteca de schema. */
export function validateHlsInfo(_input: unknown): HlsInfoValidation {
  throw new Error('NotImplemented');
}
