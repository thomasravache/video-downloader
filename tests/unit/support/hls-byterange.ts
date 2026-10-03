/** Playlists com faixas de bytes para os testes da SPEC-0013 (sem token). Não é teste. */

export const BR_BASE = 'https://cdn.example.test/curso/aula_1080p.m3u8';
export const BR_FILE = 'https://cdn.example.test/curso/aula_1080p.mp4';

/** Forma da playlist real do curso (rc.2, 2026-10-02): MAP BYTERANGE="893@0", 1º segmento len@off, demais só len. */
export const COURSE_LENGTHS = [1_060_672, 987_654, 1_012_345, 543_210];
export const COURSE_FIRST_OFFSET = 1573;

export const COURSE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MAP:URI="aula_1080p.mp4",BYTERANGE="893@0"
#EXTINF:4.000,
#EXT-X-BYTERANGE:${String(COURSE_LENGTHS[0])}@${String(COURSE_FIRST_OFFSET)}
aula_1080p.mp4
#EXTINF:4.000,
#EXT-X-BYTERANGE:${String(COURSE_LENGTHS[1])}
aula_1080p.mp4
#EXTINF:4.000,
#EXT-X-BYTERANGE:${String(COURSE_LENGTHS[2])}
aula_1080p.mp4
#EXTINF:2.500,
#EXT-X-BYTERANGE:${String(COURSE_LENGTHS[3])}
aula_1080p.mp4
#EXT-X-ENDLIST
`;

const HEAD = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:4\n';

/** Playlist de mídia com as linhas dadas (cada item: [linha BYTERANGE|'' , uri]). */
export function playlistOf(segments: [string, string][], map = ''): string {
  const body = segments
    .map(
      ([range, uri]) => `#EXTINF:4.0,\n${range === '' ? '' : `#EXT-X-BYTERANGE:${range}\n`}${uri}`,
    )
    .join('\n');
  return `${HEAD}${map}${body}\n#EXT-X-ENDLIST\n`;
}
