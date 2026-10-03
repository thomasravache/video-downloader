/**
 * Ajudantes dos testes da SPEC-0014 (vídeo e áudio em arquivos separados). Não é teste.
 *
 *  - `splitTrack('video'|'audio')`: a trilha REAL de e2e/fixtures/hls/split-av (fMP4 de arquivo único gerado
 *    com ffmpeg: `video.mp4` só H.264, `audio.mp4` só AAC, ambas com track_ID 1), já fatiada em init + segmentos
 *    pelas faixas da playlist;
 *  - `splitRoutes`: serve master + playlists + arquivos sobre o servidor local (arquivos com `Range`);
 *  - `singleFile`: monta arquivo único + playlist com BYTERANGE a partir de init/segmentos quaisquer;
 *  - `startSplitDownload`: mensagem `download` com `variantIndex`/`audioIndex` (SPEC-0014 §6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { parseMediaSegments } from '../../../src/core/hls-download';
import type { BackgroundHarness } from './background';
import { body, rangeHandler } from './playlist-server';
import type { Handler, PlaylistServer, RangeMode } from './playlist-server';
import { concat } from '../../unit/support/hls-clip';

export const SPLIT_DIR = resolve(import.meta.dirname, '../../../e2e/fixtures/hls/split-av');
export const splitBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(SPLIT_DIR, name)));
export const splitText = (name: string): string => readFileSync(resolve(SPLIT_DIR, name), 'utf8');

export interface SplitTrack {
  /** Arquivo único inteiro. */
  file: Uint8Array;
  /** Texto da playlist de mídia (URIs relativas `video.mp4`/`audio.mp4`). */
  playlist: string;
  init: Uint8Array;
  segments: Uint8Array[];
  /** Cabeçalhos `Range` esperados: init primeiro, depois cada segmento. */
  ranges: string[];
}

const rangeOf = ({ offset, length }: { offset: number; length: number }): string =>
  `bytes=${String(offset)}-${String(offset + length - 1)}`;

export function splitTrack(kind: 'video' | 'audio'): SplitTrack {
  const file = splitBytes(`${kind}.mp4`);
  const playlist = splitText(`${kind}.m3u8`);
  const media = parseMediaSegments(playlist, `https://cdn.example.test/${kind}.m3u8`);
  const { initRange, ranges } = media;
  if (!initRange || !ranges) {
    throw new Error(`fixture split-av/${kind} sem BYTERANGE`);
  }
  const slice = (r: { offset: number; length: number }): Uint8Array =>
    file.slice(r.offset, r.offset + r.length);
  return {
    file,
    playlist,
    init: slice(initRange),
    segments: ranges.map((r) => slice(r as { offset: number; length: number })),
    ranges: [initRange, ...ranges].map((r) => rangeOf(r as { offset: number; length: number })),
  };
}

/** Arquivo único (init + segmentos) e a playlist com BYTERANGE (MAP `len@0`, 1º segmento `len@off`, demais `len`). */
export function singleFile(
  init: Uint8Array,
  segments: readonly Uint8Array[],
  uri: string,
): { file: Uint8Array; playlist: string; ranges: string[] } {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="${String(init.byteLength)}@0"`,
  ];
  const ranges = [rangeOf({ offset: 0, length: init.byteLength })];
  let at = init.byteLength;
  segments.forEach((segment, i) => {
    lines.push(
      '#EXTINF:2.0,',
      `#EXT-X-BYTERANGE:${String(segment.byteLength)}${i === 0 ? `@${String(at)}` : ''}`,
      uri,
    );
    ranges.push(rangeOf({ offset: at, length: segment.byteLength }));
    at += segment.byteLength;
  });
  lines.push('#EXT-X-ENDLIST', '');
  return { file: concat([init, ...segments]), playlist: lines.join('\n'), ranges };
}

/** Playlist de mídia FMP4 só de metadados (nenhum arquivo existe): um trecho enorme, para os limites. */
export function hugePlaylist(uri: string, lengths: number[]): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:2',
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="893@0"`,
  ];
  lengths.forEach((length, i) => {
    lines.push('#EXTINF:2.0,', `#EXT-X-BYTERANGE:${String(length)}${i === 0 ? '@1573' : ''}`, uri);
  });
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

/** Playlist TS (sem EXT-X-MAP): trilha que não é fMP4. */
export const tsPlaylist = (prefix: string): string =>
  [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    '#EXTINF:2.0,',
    `${prefix}0.ts`,
    '#EXTINF:2.0,',
    `${prefix}1.ts`,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

/** Adiciona uma tag de chave AES-128 (com URI) depois de EXT-X-VERSION. */
export const withKey = (playlist: string, keyUri = 'key.bin'): string =>
  playlist.replace(/(#EXT-X-VERSION:\d+\n)/, `$1#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}"\n`);

export const withoutEndlist = (playlist: string): string =>
  playlist.replace('#EXT-X-ENDLIST\n', '');

export const MEDIA = (name: string): string => `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",${name}`;

/** Master com o texto das linhas dadas (cada uma já completa). */
export const masterOf = (...lines: string[]): string =>
  `#EXTM3U\n#EXT-X-VERSION:7\n${lines.join('\n')}\n`;

export const STREAM = (uri: string, group?: string, bandwidth = 200_000): string =>
  `#EXT-X-STREAM-INF:BANDWIDTH=${String(bandwidth)},RESOLUTION=320x180,CODECS="avc1.4d4015,mp4a.40.2"${
    group === undefined ? '' : `,AUDIO="${group}"`
  }\n${uri}`;

export const AUDIO_MEDIA = (
  group: string,
  name: string,
  uri: string | undefined,
  { language = 'en', isDefault = false } = {},
): string =>
  `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${group}",NAME="${name}",LANGUAGE="${language}",DEFAULT=${
    isDefault ? 'YES' : 'NO'
  },AUTOSELECT=YES${uri === undefined ? '' : `,URI="${uri}"`}`;

type Source = string | Handler;
const asHandler = (source: Source): Handler => (typeof source === 'string' ? body(source) : source);

export interface SplitRoutesOptions {
  /** Master servida em `<prefix>/master.m3u8` (padrão: a fixture). */
  master?: Source;
  videoPlaylist?: Source;
  audioPlaylist?: Source;
  videoFile?: Uint8Array;
  audioFile?: Uint8Array;
  videoMode?: RangeMode;
  audioMode?: RangeMode;
  /** Rotas extras (sobrepõem as demais). */
  extra?: Record<string, Handler>;
}

/** Rotas `<prefix>/{master,video,audio}.m3u8` e `<prefix>/{video,audio}.mp4` (esses com `Range`). */
export function splitRoutes(prefix = '/av', o: SplitRoutesOptions = {}): Record<string, Handler> {
  const video = splitTrack('video');
  const audio = splitTrack('audio');
  return {
    [`${prefix}/master.m3u8`]: asHandler(o.master ?? splitText('master.m3u8')),
    [`${prefix}/video.m3u8`]: asHandler(o.videoPlaylist ?? video.playlist),
    [`${prefix}/audio.m3u8`]: asHandler(o.audioPlaylist ?? audio.playlist),
    [`${prefix}/video.mp4`]: rangeHandler(o.videoFile ?? video.file, { mode: o.videoMode ?? 'ok' }),
    [`${prefix}/audio.mp4`]: rangeHandler(o.audioFile ?? audio.file, { mode: o.audioMode ?? 'ok' }),
    ...o.extra,
  };
}

/** Requisições de MÍDIA (arquivos de vídeo/áudio, TS ou fMP4) registradas pelo servidor. */
export const isMediaRequest = (url: string): boolean =>
  /\.(mp4|ts|m4s|mpegts)$/.test(new URL(url, 'http://x').pathname);

export const mediaLog = (server: PlaylistServer) => server.log.filter((r) => isMediaRequest(r.url));
export const playlistLog = (server: PlaylistServer): string[] =>
  server.requests.filter((u) => /\.m3u8(\?|$)/.test(u)).map((u) => new URL(u, 'http://x').pathname);

export type SplitDownloadResult = { ok: true; jobId: string } | { ok: false; error: string };

/** `download` com `variantIndex`/`audioIndex` (SPEC-0014). */
export async function startSplitDownload(
  bg: BackgroundHarness,
  candidateId: string,
  options: { variantIndex?: number; audioIndex?: number } = {},
): Promise<SplitDownloadResult> {
  return (await bg.send({
    type: 'download',
    candidateId,
    ...(options.variantIndex !== undefined && { variantIndex: options.variantIndex }),
    ...(options.audioIndex !== undefined && { audioIndex: options.audioIndex }),
  })) as SplitDownloadResult;
}

/** Captura tudo o que vai ao console, para provar que nada vaza (devolve a lista viva). */
export function captureConsole(): string[] {
  const logged: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
  return logged;
}
