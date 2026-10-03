/**
 * Ajudantes dos testes da SPEC-0015 (fontes redundantes recolhidas). Não é teste.
 *
 *  - `courseMaster`: master com N variantes (`v<i>.m3u8`, banda decrescente) e M faixas de áudio (`a<j>.m3u8`,
 *    todas no grupo `a1`, a primeira DEFAULT); cada playlist de mídia cita o seu arquivo `v<i>.mp4`/`a<j>.mp4`;
 *  - `courseRoutes`: servidor local com a master, as playlists de variante/áudio (opcionalmente com token na
 *    query dos URIs) e os arquivos de mídia (200 B; um teste que os pedir os verá em `mediaLog`);
 *  - `observeTab`: abre uma aba, observa a master e os demais recursos como a rede (webRequest) e roda `detect`,
 *    deixando a lista da aba completa ANTES do `resolveHls`;
 *  - `playlistPaths`: caminhos (sem query) das playlists requisitadas, para provar quais buscas foram feitas.
 */
import type { BackgroundHarness } from './background';
import { PAGE, HLS_HEADERS, detectCandidate } from './hls-job';
import { body } from './playlist-server';
import type { Handler, PlaylistServer } from './playlist-server';
import { AUDIO_MEDIA, STREAM, masterOf } from './split-av';
import type { VideoCandidate } from '../../../src/core/contracts';

export const COURSE = '/c';
export interface CourseOptions {
  variants: number;
  audio: number;
  /** Query acrescentada aos URIs de playlists e de mídia (ex.: `?token=abc&expires=1`). */
  query?: string;
}

/** Playlist de mídia fMP4 de arquivo único (EXT-X-MAP + BYTERANGE) que cita `uri`. */
export function mediaPlaylist(uri: string): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="100@0"`,
    '#EXTINF:2.0,',
    '#EXT-X-BYTERANGE:1000@100',
    uri,
    '#EXTINF:2.0,',
    '#EXT-X-BYTERANGE:1000',
    uri,
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
}

export function courseMaster({ variants, audio, query = '' }: CourseOptions): string {
  return masterOf(
    ...Array.from({ length: audio }, (_, j) =>
      AUDIO_MEDIA('a1', `Track ${String(j)}`, `a${String(j)}.m3u8${query}`, {
        isDefault: j === 0,
        language: j === 0 ? 'en' : 'pt',
      }),
    ),
    ...Array.from({ length: variants }, (_, i) =>
      STREAM(`v${String(i)}.m3u8${query}`, 'a1', 1_000_000 - i * 100_000),
    ),
  );
}

/** Rotas da master `${COURSE}/master.m3u8`; `extra` sobrepõe qualquer rota (falhas, atrasos). */
export function courseRoutes(
  options: CourseOptions,
  extra: Record<string, Handler> = {},
): Record<string, Handler> {
  const query = options.query ?? '';
  const routes: Record<string, Handler> = {
    [`${COURSE}/master.m3u8`]: body(courseMaster(options)),
  };
  for (let i = 0; i < options.variants; i++) {
    routes[`${COURSE}/v${String(i)}.m3u8`] = body(mediaPlaylist(`v${String(i)}.mp4${query}`));
    routes[`${COURSE}/v${String(i)}.mp4`] = body('x', 'video/mp4');
  }
  for (let j = 0; j < options.audio; j++) {
    routes[`${COURSE}/a${String(j)}.m3u8`] = body(mediaPlaylist(`a${String(j)}.mp4${query}`));
    routes[`${COURSE}/a${String(j)}.mp4`] = body('x', 'video/mp4');
  }
  return { ...routes, ...extra };
}

export const FILE_HEADERS = { 'Content-Type': 'video/mp4', 'Content-Length': '300000' };

/**
 * Aba nova com a master + `others` observados (`.m3u8` como HLS, o resto como arquivo de vídeo de 300 KB),
 * depois `detect`. Devolve a master e o `tabId`.
 */
export async function observeTab(
  bg: BackgroundHarness,
  masterUrl: string,
  others: string[] = [],
): Promise<{ master: VideoCandidate; tabId: number }> {
  const tabId = await bg.newTab(PAGE);
  await bg.network.respond({ url: masterUrl, tabId, headers: HLS_HEADERS });
  for (const url of others) {
    const isPlaylist = new URL(url).pathname.endsWith('.m3u8');
    await bg.network.respond({
      url,
      tabId,
      headers: isPlaylist ? HLS_HEADERS : FILE_HEADERS,
    });
  }
  return { master: await detectCandidate(bg, tabId, masterUrl), tabId };
}

export const playlistPaths = (server: PlaylistServer): string[] =>
  server.requests.filter((u) => /\.m3u8(\?|$)/.test(u)).map((u) => new URL(u, 'http://x').pathname);

/** Handler que demora `ms` e mede o máximo de requisições simultâneas (prova de paralelismo). */
export function slow(
  ms: number,
  inner: Handler,
  counter: { inflight: number; max: number },
): Handler {
  return (req, res) => {
    counter.inflight += 1;
    counter.max = Math.max(counter.max, counter.inflight);
    setTimeout(() => {
      counter.inflight -= 1;
      inner(req, res);
    }, ms);
  };
}
